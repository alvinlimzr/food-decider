import { useEffect, useMemo, useRef, useState } from 'react'
import { Routes, Route, useNavigate, useParams, Link } from 'react-router-dom'
import { supabase } from './supabase'

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

function getParticipantStorageKey(roomCode) {
  return `food-decider-participant-${roomCode}`
}

function HomePage() {
  const navigate = useNavigate()
  const [joinCode, setJoinCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCreateRoom() {
    setLoading(true)
    setError('')

    try {
      let createdRoom = null
      let attempts = 0

      while (!createdRoom && attempts < 5) {
        const code = generateRoomCode()

        const { data, error: insertError } = await supabase
          .from('rooms')
          .insert({ code })
          .select()
          .single()

        if (!insertError && data) {
          createdRoom = data
        }

        attempts += 1
      }

      if (!createdRoom) {
        throw new Error('Could not create room. Please try again.')
      }

      navigate(`/room/${createdRoom.code}`)
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  function handleJoinRoom(e) {
    e.preventDefault()
    const cleaned = joinCode.trim().toUpperCase()
    if (!cleaned) return
    navigate(`/room/${cleaned}`)
  }

  return (
    <div className="app-shell">
      <div className="card hero-card">
        <p className="eyebrow">Food Decider</p>
        <h1>Pick a place without the group chat chaos.</h1>
        <p className="subtext">
          Create a room, share the code, add options, and drag your 100 points toward what you actually want to eat.
        </p>

        <div className="actions">
          <button className="btn btn-primary" onClick={handleCreateRoom} disabled={loading}>
            {loading ? 'Creating...' : 'Create room'}
          </button>
        </div>

        <form className="join-form" onSubmit={handleJoinRoom}>
          <label className="field-label" htmlFor="join-code">
            Join with room code
          </label>
          <div className="join-row">
            <input
              id="join-code"
              className="input"
              placeholder="Enter 6-character code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6}
            />
            <button className="btn btn-secondary" type="submit">
              Join
            </button>
          </div>
        </form>

        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </div>
  )
}

function RoomPage() {
  const { code } = useParams()
  const upperCode = useMemo(() => (code || '').toUpperCase(), [code])

  const [room, setRoom] = useState(null)
  const [participantId, setParticipantId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [participants, setParticipants] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [votes, setVotes] = useState([])
  const [draftVotes, setDraftVotes] = useState({})
  const [suggestionInput, setSuggestionInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingName, setSavingName] = useState(false)
  const [addingSuggestion, setAddingSuggestion] = useState(false)
  const [savingVotes, setSavingVotes] = useState(false)
  const [error, setError] = useState('')

  const saveTimeoutRef = useRef(null)
  const latestDraftRef = useRef({})
  const skipHydrateRef = useRef(false)

  useEffect(() => {
    let active = true

    async function bootstrapRoom() {
      setLoading(true)
      setError('')

      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', upperCode)
        .maybeSingle()

      if (!active) return

      if (roomError) {
        setError(roomError.message)
        setLoading(false)
        return
      }

      if (!roomData) {
        setError('Room not found.')
        setLoading(false)
        return
      }

      setRoom(roomData)

      let localParticipantId = localStorage.getItem(getParticipantStorageKey(upperCode))

      if (localParticipantId) {
        const { data: existingParticipant } = await supabase
          .from('participants')
          .select('*')
          .eq('id', localParticipantId)
          .eq('room_id', roomData.id)
          .maybeSingle()

        if (existingParticipant) {
          setParticipantId(existingParticipant.id)
          setDisplayName(existingParticipant.display_name)
          setNameInput(existingParticipant.display_name)
        } else {
          localParticipantId = ''
          localStorage.removeItem(getParticipantStorageKey(upperCode))
        }
      }

      if (!localParticipantId) {
        const defaultName = `Hungry Friend ${Math.floor(Math.random() * 900 + 100)}`

        const { data: newParticipant, error: participantError } = await supabase
          .from('participants')
          .insert({
            room_id: roomData.id,
            display_name: defaultName,
          })
          .select()
          .single()

        if (participantError) {
          setError(participantError.message)
          setLoading(false)
          return
        }

        localStorage.setItem(getParticipantStorageKey(upperCode), newParticipant.id)
        setParticipantId(newParticipant.id)
        setDisplayName(newParticipant.display_name)
        setNameInput(newParticipant.display_name)
      }

      await loadRoomData(roomData.id)

      if (active) {
        setLoading(false)
      }
    }

    async function loadRoomData(roomId) {
      const [{ data: participantRows }, { data: suggestionRows }, { data: voteRows }] = await Promise.all([
        supabase.from('participants').select('*').eq('room_id', roomId).order('created_at', { ascending: true }),
        supabase.from('suggestions').select('*').eq('room_id', roomId).order('created_at', { ascending: true }),
        supabase.from('votes').select('*').eq('room_id', roomId),
      ])

      if (!active) return

      setParticipants(participantRows || [])
      setSuggestions(suggestionRows || [])
      setVotes(voteRows || [])
    }

    bootstrapRoom()

    return () => {
      active = false
    }
  }, [upperCode])

  useEffect(() => {
    if (!room?.id) return

    const channel = supabase
      .channel(`room-${room.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participants', filter: `room_id=eq.${room.id}` },
        () => refreshRoomData(room.id)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'suggestions', filter: `room_id=eq.${room.id}` },
        () => refreshRoomData(room.id)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'votes', filter: `room_id=eq.${room.id}` },
        () => refreshRoomData(room.id)
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [room?.id])

  useEffect(() => {
    if (!participantId) return
    if (skipHydrateRef.current) {
      skipHydrateRef.current = false
      return
    }

    const mine = {}
    for (const vote of votes) {
      if (vote.participant_id === participantId) {
        mine[vote.suggestion_id] = vote.points
      }
    }

    setDraftVotes(mine)
    latestDraftRef.current = mine
  }, [votes, participantId])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  async function refreshRoomData(roomId) {
    const [{ data: participantRows }, { data: suggestionRows }, { data: voteRows }] = await Promise.all([
      supabase.from('participants').select('*').eq('room_id', roomId).order('created_at', { ascending: true }),
      supabase.from('suggestions').select('*').eq('room_id', roomId).order('created_at', { ascending: true }),
      supabase.from('votes').select('*').eq('room_id', roomId),
    ])

    setParticipants(participantRows || [])
    setSuggestions(suggestionRows || [])
    setVotes(voteRows || [])
  }

  const myUsedPoints = useMemo(() => {
    return Object.values(draftVotes).reduce((sum, value) => sum + value, 0)
  }, [draftVotes])

  const myRemainingPoints = 100 - myUsedPoints

  const optimisticVotes = useMemo(() => {
    if (!participantId) return votes

    const others = votes.filter((vote) => vote.participant_id !== participantId)
    const mine = Object.entries(draftVotes)
      .filter(([, points]) => points > 0)
      .map(([suggestionId, points]) => ({
        room_id: room?.id,
        participant_id: participantId,
        suggestion_id: suggestionId,
        points,
      }))

    return [...others, ...mine]
  }, [votes, draftVotes, participantId, room?.id])

  const totalsBySuggestion = useMemo(() => {
    const map = {}
    for (const suggestion of suggestions) {
      map[suggestion.id] = 0
    }
    for (const vote of optimisticVotes) {
      map[vote.suggestion_id] = (map[vote.suggestion_id] || 0) + vote.points
    }
    return map
  }, [optimisticVotes, suggestions])

  const sortedSuggestions = useMemo(() => {
    return [...suggestions].sort((a, b) => {
      const diff = (totalsBySuggestion[b.id] || 0) - (totalsBySuggestion[a.id] || 0)
      if (diff !== 0) return diff
      return a.created_at.localeCompare(b.created_at)
    })
  }, [suggestions, totalsBySuggestion])

  const topThree = useMemo(() => {
    return sortedSuggestions.slice(0, 3)
  }, [sortedSuggestions])

  const topMax = useMemo(() => {
    if (topThree.length === 0) return 1
    return Math.max(...topThree.map((item) => totalsBySuggestion[item.id] || 0), 1)
  }, [topThree, totalsBySuggestion])

  async function handleSaveName(e) {
    e.preventDefault()
    if (!participantId) return

    const trimmed = nameInput.trim()
    if (!trimmed) return

    setSavingName(true)
    setError('')

    const { error } = await supabase
      .from('participants')
      .update({ display_name: trimmed })
      .eq('id', participantId)

    if (error) {
      setError(error.message)
    } else {
      setDisplayName(trimmed)
    }

    setSavingName(false)
  }

  async function handleAddSuggestion(e) {
    e.preventDefault()
    if (!room?.id || !participantId) return

    const trimmed = suggestionInput.trim()
    if (!trimmed) return

    const alreadyExists = suggestions.some(
      (item) => item.name.trim().toLowerCase() === trimmed.toLowerCase()
    )

    if (alreadyExists) {
      setError('That place is already in the list.')
      return
    }

    setAddingSuggestion(true)
    setError('')

    const { error } = await supabase
      .from('suggestions')
      .insert({
        room_id: room.id,
        participant_id: participantId,
        name: trimmed,
      })

    if (error) {
      setError(error.message)
    } else {
      setSuggestionInput('')
    }

    setAddingSuggestion(false)
  }

  function scheduleVoteSave(nextDraft) {
    latestDraftRef.current = nextDraft

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(async () => {
      if (!room?.id || !participantId) return

      const entries = Object.entries(latestDraftRef.current)
      setSavingVotes(true)

      try {
        const mineInDb = votes.filter((vote) => vote.participant_id === participantId)
        const dbMap = {}
        for (const vote of mineInDb) {
          dbMap[vote.suggestion_id] = vote
        }

        const toUpsert = entries
          .filter(([, points]) => points > 0)
          .map(([suggestionId, points]) => ({
            room_id: room.id,
            participant_id: participantId,
            suggestion_id: suggestionId,
            points,
          }))

        const toDeleteIds = mineInDb
          .filter((vote) => !(latestDraftRef.current[vote.suggestion_id] > 0))
          .map((vote) => vote.id)

        if (toUpsert.length > 0) {
          const { error: upsertError } = await supabase
            .from('votes')
            .upsert(toUpsert, { onConflict: 'participant_id,suggestion_id' })

          if (upsertError) throw upsertError
        }

        if (toDeleteIds.length > 0) {
          const { error: deleteError } = await supabase
            .from('votes')
            .delete()
            .in('id', toDeleteIds)

          if (deleteError) throw deleteError
        }

        skipHydrateRef.current = true
        await refreshRoomData(room.id)
      } catch (err) {
        setError(err.message || 'Could not save votes.')
      } finally {
        setSavingVotes(false)
      }
    }, 220)
  }

  function handleSliderChange(suggestionId, rawValue) {
    const nextValue = Number(rawValue)

    setDraftVotes((prev) => {
      const current = prev[suggestionId] || 0
      const usedWithoutCurrent = Object.values(prev).reduce((sum, value) => sum + value, 0) - current
      const allowed = Math.max(0, 100 - usedWithoutCurrent)
      const clamped = Math.min(nextValue, allowed)

      const nextDraft = {
        ...prev,
        [suggestionId]: clamped,
      }

      if (clamped === 0) {
        delete nextDraft[suggestionId]
      }

      scheduleVoteSave(nextDraft)
      return nextDraft
    })
  }

  if (loading) {
    return (
      <div className="app-shell">
        <div className="card room-card">
          <h2>Loading room...</h2>
          <p className="subtext">Setting up your seat at the table.</p>
        </div>
      </div>
    )
  }

  if (error === 'Room not found.') {
    return (
      <div className="app-shell">
        <div className="card room-card">
          <div className="room-topbar">
            <Link to="/" className="back-link">← Back</Link>
            <span className="room-pill">Code: {upperCode}</span>
          </div>
          <h2>Couldn’t open room</h2>
          <p className="error-text">{error}</p>
        </div>
      </div>
    )
  }

  const leader = topThree[0]

  return (
    <div className="app-shell">
      <div className="card room-card">
        <div className="room-topbar">
          <Link to="/" className="back-link">← Back</Link>
          <span className="room-pill">Code: {upperCode}</span>
        </div>

        <div className="winner-banner">
          <div>
            <p className="eyebrow">Current leader</p>
            <h2>{leader ? leader.name : 'Waiting for suggestions'}</h2>
            <p className="subtext small">
              {leader ? `${totalsBySuggestion[leader.id] || 0} total points so far.` : 'Add a place to get started.'}
            </p>
          </div>
          <div className="sync-badge">{savingVotes ? 'Saving…' : 'Live'}</div>
        </div>

        <div className="room-grid">
          <section className="panel">
            <p className="eyebrow">You</p>
            <h2>{displayName || 'Hungry Friend'}</h2>
            <p className="subtext small">
              You have <strong>{myRemainingPoints}</strong> points left out of 100.
            </p>

            <form onSubmit={handleSaveName} className="stack-form">
              <label className="field-label" htmlFor="display-name">
                Rename yourself
              </label>
              <div className="join-row">
                <input
                  id="display-name"
                  className="input"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Enter your display name"
                  maxLength={30}
                />
                <button className="btn btn-secondary" type="submit" disabled={savingName}>
                  {savingName ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>

            <div className="meter-wrap">
              <div className="meter-labels">
                <span>Used {myUsedPoints}</span>
                <span>Remaining {myRemainingPoints}</span>
              </div>
              <div className="meter">
                <div
                  className="meter-fill"
                  style={{ width: `${Math.min(myUsedPoints, 100)}%` }}
                />
              </div>
            </div>

            <div className="people-list">
              <p className="field-label">People in room</p>
              {participants.map((person) => (
                <div key={person.id} className="person-chip">
                  {person.display_name}
                </div>
              ))}
            </div>
          </section>

          <section className="panel panel-wide">
            <div className="results-top">
              <div>
                <p className="eyebrow">Live ranking</p>
                <h3>Top 3 right now</h3>
              </div>
            </div>

            <div className="rank-chart">
              {topThree.length === 0 ? (
                <div className="empty-state">
                  <p>No ranking yet. Add suggestions to see the leaderboard.</p>
                </div>
              ) : (
                topThree.map((item, index) => {
                  const total = totalsBySuggestion[item.id] || 0
                  const width = `${(total / topMax) * 100}%`

                  return (
                    <div key={item.id} className="rank-row">
                      <div className="rank-head">
                        <span className="rank-index">#{index + 1}</span>
                        <span className="rank-name">{item.name}</span>
                        <span className="rank-total">{total}</span>
                      </div>
                      <div className="rank-track">
                        <div className="rank-fill" style={{ width }} />
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <form onSubmit={handleAddSuggestion} className="stack-form add-form">
              <label className="field-label" htmlFor="suggestion-name">
                Add a place
              </label>
              <div className="join-row">
                <input
                  id="suggestion-name"
                  className="input"
                  value={suggestionInput}
                  onChange={(e) => setSuggestionInput(e.target.value)}
                  placeholder="e.g. Shake Shack, Sushiro, Din Tai Fung"
                />
                <button className="btn btn-primary" type="submit" disabled={addingSuggestion}>
                  {addingSuggestion ? 'Adding...' : 'Add'}
                </button>
              </div>
            </form>

            {error && error !== 'Room not found.' ? <p className="error-text">{error}</p> : null}

            <div className="suggestion-list">
              {sortedSuggestions.length === 0 ? (
                <div className="empty-state">
                  <p>No places yet. Add the first suggestion.</p>
                </div>
              ) : (
                sortedSuggestions.map((item) => {
                  const myPoints = draftVotes[item.id] || 0
                  const totalPoints = totalsBySuggestion[item.id] || 0
                  const usedWithoutCurrent = myUsedPoints - myPoints
                  const maxAllowed = 100 - usedWithoutCurrent
                  const sliderPercent = `${myPoints}%`

                  return (
                    <div key={item.id} className="suggestion-card">
                      <div className="suggestion-main">
                        <div className="suggestion-copy">
                          <h3>{item.name}</h3>
                          <p className="suggestion-meta">
                            Total: {totalPoints} points · Yours: {myPoints}
                          </p>
                        </div>
                        <div className="pill-total">{totalPoints}</div>
                      </div>

                      <div className="slider-block">
                        <div className="slider-labels">
                          <span>0</span>
                          <span>Your points: {myPoints}</span>
                          <span>{maxAllowed}</span>
                        </div>

                        <input
                          type="range"
                          min="0"
                          max={maxAllowed}
                          step="1"
                          value={myPoints}
                          onChange={(e) => handleSliderChange(item.id, e.target.value)}
                          className="vote-slider"
                          style={{
                            background: `linear-gradient(to right, #0f6c70 0%, #0f6c70 ${sliderPercent}, #e8dfd5 ${sliderPercent}, #e8dfd5 100%)`,
                          }}
                        />
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/room/:code" element={<RoomPage />} />
    </Routes>
  )
}