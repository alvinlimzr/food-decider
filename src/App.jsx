import { useEffect, useMemo, useRef, useState } from 'react'
import { Routes, Route, useNavigate, useParams, Link } from 'react-router-dom'
import { supabase } from './supabase'

const PARTICIPANT_COLORS = [
  { solid: '#d85b66', soft: 'rgba(216, 91, 102, 0.18)' },
  { solid: '#4f7cff', soft: 'rgba(79, 124, 255, 0.18)' },
  { solid: '#31a27c', soft: 'rgba(49, 162, 124, 0.18)' },
  { solid: '#d08a2f', soft: 'rgba(208, 138, 47, 0.18)' },
  { solid: '#8a63d2', soft: 'rgba(138, 99, 210, 0.18)' },
  { solid: '#d05fa8', soft: 'rgba(208, 95, 168, 0.18)' },
  { solid: '#2f9db1', soft: 'rgba(47, 157, 177, 0.18)' },
  { solid: '#7a9852', soft: 'rgba(122, 152, 82, 0.18)' },
]

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

function truncateLabel(value, max = 50) {
  const text = String(value ?? '').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max)}...`
}

function roomLink(code) {
  return `${window.location.origin}/room/${code}`
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
          Create a room, share the code, add options, and drag your 100 points
          toward what you actually want to eat.
        </p>

        <div className="actions">
          <button
            className="btn btn-primary"
            onClick={handleCreateRoom}
            disabled={loading}
          >
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
  const navigate = useNavigate()
  const { code } = useParams()
  const upperCode = useMemo(() => code?.toUpperCase() ?? '', [code])

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
  const [deletingSuggestionId, setDeletingSuggestionId] = useState('')
  const [savingVotes, setSavingVotes] = useState(false)
  const [copyMessage, setCopyMessage] = useState('')
  const [error, setError] = useState('')
  const [isRemoved, setIsRemoved] = useState(false)

  const saveTimeoutRef = useRef(null)
  const latestDraftRef = useRef({})
  const skipHydrateRef = useRef(false)
  const copyTimerRef = useRef(null)
  const redirectTimerRef = useRef(null)

  async function refreshRoomData(roomId) {
    const [
      { data: participantRows, error: participantsError },
      { data: suggestionRows, error: suggestionsError },
      { data: voteRows, error: votesError },
    ] = await Promise.all([
      supabase
        .from('participants')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true }),
      supabase
        .from('suggestions')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true }),
      supabase
        .from('votes')
        .select('*')
        .eq('room_id', roomId),
    ])

    if (participantsError) throw participantsError
    if (suggestionsError) throw suggestionsError
    if (votesError) throw votesError

    setParticipants(participantRows ?? [])
    setSuggestions(suggestionRows ?? [])
    setVotes(voteRows ?? [])
  }

  function handleRemovedFromSession() {
    if (isRemoved) return

    setIsRemoved(true)
    localStorage.removeItem(getParticipantStorageKey(upperCode))
    setParticipantId('')
    setDisplayName('')
    setNameInput('')
    setDraftVotes({})
    latestDraftRef.current = {}
    setVotes([])
    setSuggestions([])
    setParticipants([])

    window.alert('You have been removed from this session.')

    if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current)
    redirectTimerRef.current = setTimeout(() => {
      navigate('/', { replace: true })
    }, 50)
  }

  useEffect(() => {
    let active = true

    async function bootstrapRoom() {
      setLoading(true)
      setError('')

      try {
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

        let localParticipantId = localStorage.getItem(
          getParticipantStorageKey(upperCode)
        )

        if (localParticipantId) {
          const { data: existingParticipant } = await supabase
            .from('participants')
            .select('*')
            .eq('id', localParticipantId)
            .eq('room_id', roomData.id)
            .maybeSingle()

          if (!active) return

          if (existingParticipant) {
            setParticipantId(existingParticipant.id)
            setDisplayName(existingParticipant.display_name)
            setNameInput(existingParticipant.display_name)
          } else {
            localStorage.removeItem(getParticipantStorageKey(upperCode))
            localParticipantId = null
          }
        }

        if (!localParticipantId && !isRemoved) {
          const defaultName = `Hungry Friend ${Math.floor(Math.random() * 900 + 100)}`

          const { data: newParticipant, error: participantError } = await supabase
            .from('participants')
            .insert({
              room_id: roomData.id,
              display_name: defaultName,
            })
            .select()
            .single()

          if (!active) return

          if (participantError) {
            setError(participantError.message)
            setLoading(false)
            return
          }

          localStorage.setItem(
            getParticipantStorageKey(upperCode),
            newParticipant.id
          )
          setParticipantId(newParticipant.id)
          setDisplayName(newParticipant.display_name)
          setNameInput(newParticipant.display_name)
        }

        await refreshRoomData(roomData.id)

        if (active) setLoading(false)
      } catch (err) {
        if (!active) return
        setError(err.message || 'Something went wrong.')
        setLoading(false)
      }
    }

    bootstrapRoom()

    return () => {
      active = false
    }
  }, [upperCode, isRemoved])

  useEffect(() => {
    if (!room?.id) return

    const channel = supabase
      .channel(`room-${room.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'participants',
          filter: `room_id=eq.${room.id}`,
        },
        async (payload) => {
          try {
            if (payload.eventType === 'DELETE') {
              const deletedId = payload.old?.id
              if (!deletedId) return

              setParticipants((prev) => prev.filter((item) => item.id !== deletedId))
              setVotes((prev) => prev.filter((vote) => vote.participant_id !== deletedId))

              if (deletedId === participantId) {
                handleRemovedFromSession()
                return
              }

              return
            }

            await refreshRoomData(room.id)
          } catch {}
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'kicks',
          filter: `room_id=eq.${room.id}`,
        },
        async (payload) => {
          try {
            const kickedParticipantId = payload.new?.participant_id
            if (!kickedParticipantId) return

            if (kickedParticipantId === participantId) {
              handleRemovedFromSession()

              await supabase
                .from('kicks')
                .delete()
                .eq('id', payload.new.id)
            }
          } catch {}
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'suggestions',
          filter: `room_id=eq.${room.id}`,
        },
        async () => {
          try {
            await refreshRoomData(room.id)
          } catch {}
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'suggestions',
          filter: `room_id=eq.${room.id}`,
        },
        async () => {
          try {
            await refreshRoomData(room.id)
          } catch {}
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'suggestions',
        },
        async (payload) => {
          try {
            const deletedId = payload.old?.id
            if (!deletedId) return

            setSuggestions((prev) => prev.filter((item) => item.id !== deletedId))
            setVotes((prev) => prev.filter((vote) => vote.suggestion_id !== deletedId))
            setDraftVotes((prev) => {
              const next = { ...prev }
              delete next[deletedId]
              latestDraftRef.current = next
              return next
            })
          } catch {}
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'votes',
          filter: `room_id=eq.${room.id}`,
        },
        async () => {
          try {
            await refreshRoomData(room.id)
          } catch {}
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [room?.id, participantId])

  useEffect(() => {
    if (!participantId) return

    if (skipHydrateRef.current) {
      skipHydrateRef.current = false
      return
    }

    if (saveTimeoutRef.current || savingVotes) {
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
  }, [votes, participantId, savingVotes])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current)
    }
  }, [])

  async function handleSaveName(e) {
    e.preventDefault()
    if (!participantId) return

    const trimmed = nameInput.trim()
    if (!trimmed) return

    setSavingName(true)
    setError('')

    const { error: updateError } = await supabase
      .from('participants')
      .update({ display_name: trimmed })
      .eq('id', participantId)

    if (updateError) {
      setError(updateError.message)
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

    if (trimmed.length > 100) {
      setError('Place name must be 100 characters or fewer.')
      return
    }

    const alreadyExists = suggestions.some(
      (item) => item.name.trim().toLowerCase() === trimmed.toLowerCase()
    )

    if (alreadyExists) {
      setError('That place is already in the list.')
      return
    }

    setAddingSuggestion(true)
    setError('')

    const { error: insertError } = await supabase.from('suggestions').insert({
      room_id: room.id,
      participant_id: participantId,
      name: trimmed,
    })

    if (insertError) {
      setError(insertError.message)
    } else {
      setSuggestionInput('')
    }

    setAddingSuggestion(false)
  }

  async function handleDeleteSuggestion(suggestionId) {
    if (!room?.id) return

    setDeletingSuggestionId(suggestionId)
    setError('')

    const previousSuggestions = suggestions
    const previousVotes = votes
    const previousDraftVotes = draftVotes

    setSuggestions((prev) => prev.filter((item) => item.id !== suggestionId))
    setVotes((prev) => prev.filter((vote) => vote.suggestion_id !== suggestionId))
    setDraftVotes((prev) => {
      const next = { ...prev }
      delete next[suggestionId]
      latestDraftRef.current = next
      return next
    })

    try {
      const { error: deleteError } = await supabase
        .from('suggestions')
        .delete()
        .eq('id', suggestionId)
        .select()

      if (deleteError) throw deleteError
    } catch (err) {
      setSuggestions(previousSuggestions)
      setVotes(previousVotes)
      setDraftVotes(previousDraftVotes)
      latestDraftRef.current = previousDraftVotes
      setError(err.message || 'Could not delete place.')
    } finally {
      setDeletingSuggestionId('')
    }
  }

  async function handleRemoveParticipant(participant) {
    if (!room?.id) return
    if (!participant?.id) return
    if (participant.id === participantId) return

    const ok = window.confirm(`Remove ${participant.display_name}?`)
    if (!ok) return

    const previousParticipants = participants
    const previousVotes = votes

    setParticipants((prev) => prev.filter((item) => item.id !== participant.id))
    setVotes((prev) => prev.filter((vote) => vote.participant_id !== participant.id))

    try {
      const { error: kickInsertError } = await supabase.from('kicks').insert({
        room_id: room.id,
        participant_id: participant.id,
      })

      if (kickInsertError) throw kickInsertError

      const { error: deleteVotesError } = await supabase
        .from('votes')
        .delete()
        .eq('room_id', room.id)
        .eq('participant_id', participant.id)

      if (deleteVotesError) throw deleteVotesError

      const { error: deleteParticipantError } = await supabase
        .from('participants')
        .delete()
        .eq('id', participant.id)

      if (deleteParticipantError) throw deleteParticipantError
    } catch (err) {
      setParticipants(previousParticipants)
      setVotes(previousVotes)
      setError(err.message || 'Could not remove user.')
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(roomLink(upperCode))
      setCopyMessage('Link copied')
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopyMessage(''), 1400)
    } catch {
      setCopyMessage('Copy failed')
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopyMessage(''), 1400)
    }
  }

  function scheduleVoteSave(nextDraft) {
    latestDraftRef.current = nextDraft

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(async () => {
      if (!room?.id || !participantId) return

      setSavingVotes(true)

      try {
        const payload = suggestions.map((suggestion) => ({
          room_id: room.id,
          participant_id: participantId,
          suggestion_id: suggestion.id,
          points: latestDraftRef.current[suggestion.id] ?? 0,
        }))

        const { error: upsertError } = await supabase
          .from('votes')
          .upsert(payload, {
            onConflict: 'participant_id,suggestion_id',
          })

        if (upsertError) throw upsertError

        skipHydrateRef.current = true
        await refreshRoomData(room.id)
      } catch (err) {
        setError(err.message || 'Could not save votes.')
      } finally {
        setSavingVotes(false)
        saveTimeoutRef.current = null
      }
    }, 220)
  }

  function handleSliderChange(suggestionId, rawValue) {
    const nextValue = Number(rawValue)

    setDraftVotes((prev) => {
      const current = prev[suggestionId] ?? 0
      const usedWithoutCurrent =
        Object.values(prev).reduce((sum, value) => sum + value, 0) - current
      const allowed = Math.max(0, 100 - usedWithoutCurrent)
      const clamped = Math.max(0, Math.min(nextValue, allowed))

      const nextDraft = {
        ...prev,
        [suggestionId]: clamped,
      }

      latestDraftRef.current = nextDraft
      scheduleVoteSave(nextDraft)

      return nextDraft
    })
  }

  const participantsWithColors = useMemo(() => {
    return participants.map((participant, index) => ({
      ...participant,
      color: PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length],
      orderIndex: index,
    }))
  }, [participants])

  const myUsedPoints = useMemo(() => {
    return Object.values(draftVotes).reduce((sum, value) => sum + value, 0)
  }, [draftVotes])

  const myRemainingPoints = 100 - myUsedPoints

  const optimisticVotes = useMemo(() => {
    if (!participantId) return votes

    const others = votes.filter((vote) => vote.participant_id !== participantId)

    const mine = suggestions.map((suggestion) => ({
      room_id: room?.id,
      participant_id: participantId,
      suggestion_id: suggestion.id,
      points: draftVotes[suggestion.id] ?? 0,
    }))

    return [...others, ...mine]
  }, [votes, draftVotes, participantId, room?.id, suggestions])

  const totalsBySuggestion = useMemo(() => {
    const map = {}

    for (const suggestion of suggestions) {
      map[suggestion.id] = 0
    }

    for (const vote of optimisticVotes) {
      map[vote.suggestion_id] = (map[vote.suggestion_id] ?? 0) + vote.points
    }

    return map
  }, [optimisticVotes, suggestions])

  const voteBreakdownBySuggestion = useMemo(() => {
    const map = {}

    for (const suggestion of suggestions) {
      map[suggestion.id] = participantsWithColors.map((participant) => ({
        participantId: participant.id,
        displayName: participant.display_name,
        points: 0,
        color: participant.color,
        orderIndex: participant.orderIndex,
      }))
    }

    for (const vote of optimisticVotes) {
      const list = map[vote.suggestion_id]
      if (!list) continue

      const item = list.find((entry) => entry.participantId === vote.participant_id)
      if (item) {
        item.points = vote.points
      }
    }

    return map
  }, [suggestions, optimisticVotes, participantsWithColors])

  const displaySuggestions = useMemo(() => {
    return [...suggestions].sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    )
  }, [suggestions])

  const sortedSuggestions = useMemo(() => {
    return [...suggestions].sort((a, b) => {
      const diff = (totalsBySuggestion[b.id] ?? 0) - (totalsBySuggestion[a.id] ?? 0)
      if (diff !== 0) return diff
      return a.created_at.localeCompare(b.created_at)
    })
  }, [suggestions, totalsBySuggestion])

  const topThree = useMemo(() => {
    return sortedSuggestions.slice(0, 3)
  }, [sortedSuggestions])

  const topMax = useMemo(() => {
    if (topThree.length === 0) return 1
    return Math.max(...topThree.map((item) => totalsBySuggestion[item.id] ?? 0), 1)
  }, [topThree, totalsBySuggestion])

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

  if (isRemoved) {
    return (
      <div className="app-shell">
        <div className="card hero-card">
          <p className="eyebrow">Session ended</p>
          <h1>You have been removed from this session.</h1>
          <p className="subtext">Taking you back to the home page.</p>
        </div>
      </div>
    )
  }

  if (error === 'Room not found.') {
    return (
      <div className="app-shell">
        <div className="card room-card">
          <div className="room-topbar">
            <Link to="/" className="back-link">
              Back
            </Link>
            <div className="room-id-wrap">
              <span className="room-id-label">ROOM ID</span>
              <span className="room-pill">
                <strong>{upperCode}</strong>
              </span>
              <button className="copy-link-btn" onClick={handleCopyLink} type="button">
                <span role="img" aria-hidden="true">🔗</span>
                Copy link
              </button>
            </div>
          </div>
          <h2>Couldn't open room</h2>
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
          <Link to="/" className="back-link">
            Back
          </Link>
          <div className="room-id-wrap">
            <span className="room-id-label">ROOM ID</span>
            <span className="room-pill">
              <strong>{upperCode}</strong>
            </span>
            <button className="copy-link-btn" onClick={handleCopyLink} type="button">
              <span role="img" aria-hidden="true">🔗</span>
              Copy link
            </button>
            {copyMessage ? <span className="copy-message">{copyMessage}</span> : null}
          </div>
        </div>

        <div className="room-stack">
          <section className="panel winner-banner">
            <div className="winner-copy">
              <p className="eyebrow">Current leader</p>
              <h2 title={leader?.name ?? ''}>
                {leader ? truncateLabel(leader.name, 50) : 'Waiting for suggestions'}
              </h2>
              <p className="subtext small">
                {leader
                  ? `${totalsBySuggestion[leader.id] ?? 0} total points so far.`
                  : 'Add a place to get started.'}
              </p>
            </div>
            <div className="sync-badge">{savingVotes ? 'Saving...' : 'Live'}</div>
          </section>

          <div className="you-points-grid">
            <section className="panel you-panel">
              <p className="eyebrow">You</p>
              <h2 title={displayName || 'Hungry Friend'}>
                {truncateLabel(displayName || 'Hungry Friend', 32)}
              </h2>

              <form onSubmit={handleSaveName} className="stack-form you-rename-form">
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
                    maxLength={60}
                  />
                  <button
                    className="btn btn-secondary"
                    type="submit"
                    disabled={savingName}
                  >
                    {savingName ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </form>
            </section>

            <section className="panel you-points-panel">
              <p className="eyebrow">Points left</p>
              <div className="you-points-value">{myRemainingPoints}</div>
              <p className="subtext small">out of 100</p>

              <div className="meter-wrap compact">
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
            </section>
          </div>

          <section className="panel">
            <div className="people-list people-list-wide">
              <p className="field-label">People in room</p>
              {participantsWithColors.map((person) => (
                <div
                  key={person.id}
                  className="person-chip"
                  style={{
                    background: person.color.soft,
                    border: `1px solid ${person.color.solid}33`,
                    color: person.color.solid,
                  }}
                  title={person.display_name}
                >
                  <span
                    className="person-dot"
                    style={{ background: person.color.solid }}
                  />
                  <span className="person-chip-text">
                    {truncateLabel(person.display_name, 22)}
                  </span>
                  <button
                    type="button"
                    className="person-remove"
                    aria-label={`Remove ${person.display_name}`}
                    onClick={() => handleRemoveParticipant(person)}
                    disabled={person.id === participantId}
                  >
                    <span role="img" aria-hidden="true">✕</span>
                  </button>
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
                  const total = totalsBySuggestion[item.id] ?? 0
                  const width = (total / topMax) * 100
                  const segments = voteBreakdownBySuggestion[item.id] ?? []

                  return (
                    <div key={item.id} className="rank-row">
                      <div className="rank-head">
                        <span className="rank-index">{index + 1}</span>
                        <span className="rank-name" title={item.name}>
                          {truncateLabel(item.name, 50)}
                        </span>
                        <span className="rank-total">{total}</span>
                      </div>

                      <div className="rank-track">
                        <div
                          className="rank-stack"
                          style={{ width: `${width}%` }}
                        >
                          {segments.map((segment) => {
                            const percent = total > 0 ? (segment.points / total) * 100 : 0
                            if (percent <= 0) return null

                            return (
                              <div
                                key={segment.participantId}
                                className="rank-segment"
                                style={{
                                  width: `${percent}%`,
                                  background: segment.color.solid,
                                }}
                                title={`${segment.displayName}: ${segment.points}`}
                              />
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </section>

          <section className="panel panel-wide">
            <form onSubmit={handleAddSuggestion} className="stack-form add-form">
              <label className="field-label" htmlFor="suggestion-name">
                Add a place
              </label>
              <div className="join-row">
                <input
                  id="suggestion-name"
                  className="input"
                  value={suggestionInput}
                  onChange={(e) => setSuggestionInput(e.target.value.slice(0, 100))}
                  placeholder="e.g. Shake Shack, Sushiro, Din Tai Fung"
                  maxLength={100}
                />
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={addingSuggestion}
                >
                  {addingSuggestion ? 'Adding...' : 'Add'}
                </button>
              </div>
              <p className="suggestion-meta">
                {suggestionInput.length}/100 characters
              </p>
            </form>

            {error && error !== 'Room not found.' ? (
              <p className="error-text">{error}</p>
            ) : null}

            <div className="suggestion-list">
              {displaySuggestions.length === 0 ? (
                <div className="empty-state">
                  <p>No places yet. Add the first suggestion.</p>
                </div>
              ) : (
                displaySuggestions.map((item) => {
                  const myPoints = draftVotes[item.id] ?? 0
                  const totalPoints = totalsBySuggestion[item.id] ?? 0
                  const usedWithoutCurrent = myUsedPoints - myPoints
                  const maxAllowed = Math.max(0, 100 - usedWithoutCurrent)
                  const sliderPercent = myPoints
                  const segments = voteBreakdownBySuggestion[item.id] ?? []

                  return (
                    <div key={item.id} className="suggestion-card">
                      <div className="suggestion-main">
                        <div className="suggestion-copy">
                          <h3 title={item.name}>{truncateLabel(item.name, 50)}</h3>
                          <p className="suggestion-meta">
                            Total {totalPoints} points · Yours {myPoints}
                          </p>
                        </div>

                        <div className="suggestion-actions">
                          <div className="pill-total">{totalPoints}</div>
                          <button
                            type="button"
                            className="btn btn-delete"
                            onClick={() => handleDeleteSuggestion(item.id)}
                            disabled={deletingSuggestionId === item.id}
                          >
                            {deletingSuggestionId === item.id ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </div>

                      <div className="stacked-total-bar">
                        {segments.map((segment) => {
                          const percent = totalPoints > 0 ? (segment.points / totalPoints) * 100 : 0
                          if (percent <= 0) return null

                          return (
                            <div
                              key={segment.participantId}
                              className="stacked-total-segment"
                              style={{
                                width: `${percent}%`,
                                background: segment.color.solid,
                              }}
                              title={`${segment.displayName}: ${segment.points}`}
                            />
                          )
                        })}
                      </div>

                      <div className="slider-block">
                        <div className="slider-labels">
                          <span>0</span>
                          <span>Your points {myPoints}</span>
                          <span>100</span>
                        </div>

                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={myPoints}
                          onChange={(e) => handleSliderChange(item.id, e.target.value)}
                          className="vote-slider"
                          style={{
                            background: `linear-gradient(to right, #0f6c70 0%, #0f6c70 ${sliderPercent}%, #e8dfd5 ${sliderPercent}%, #e8dfd5 100%)`,
                          }}
                        />

                        <p className="suggestion-meta">
                          Max you can set now: {maxAllowed}
                        </p>
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