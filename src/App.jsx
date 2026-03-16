import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, BOARD_ID } from './lib/supabase'

function hexToRgb(hex) {
  const cleaned = (hex || '#000000').replace('#', '')
  const full = cleaned.length === 3
    ? cleaned.split('').map((c) => c + c).join('')
    : cleaned

  const num = Number.parseInt(full, 16)

  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  }
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b]
    .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'))
    .join('')}`
}

function mixColors(a, b, ratio) {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)

  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * ratio,
    g: ca.g + (cb.g - ca.g) * ratio,
    b: ca.b + (cb.b - ca.b) * ratio,
  })
}

function valueToColor(value, colors, reversed = false) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0))

  const low = reversed ? colors.high_color : colors.low_color
  const medium = colors.medium_color
  const high = reversed ? colors.low_color : colors.high_color

  if (safe <= 50) {
    return mixColors(low, medium, safe / 50)
  }

  return mixColors(medium, high, (safe - 50) / 50)
}

function clampValue(value) {
  return Math.max(0, Math.min(100, Number(value) || 0))
}

function formatTimestamp(value) {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Invalid date'

  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function sortNewestFirst(items) {
  return [...items].sort((a, b) => {
    const aTime = new Date(a.created_at || 0).getTime()
    const bTime = new Date(b.created_at || 0).getTime()
    return bTime - aTime
  })
}

export default function App() {
  const [board, setBoard] = useState(null)
  const [rows, setRows] = useState([])
  const [sliders, setSliders] = useState([])
  const [profiles, setProfiles] = useState([])
  const [notes, setNotes] = useState([])
  const [noteDraft, setNoteDraft] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showAverages, setShowAverages] = useState(() => {
    const saved = localStorage.getItem('show-row-averages')
    return saved === null ? true : saved === 'true'
  })

  const channelRef = useRef(null)
  const clientIdRef = useRef(crypto.randomUUID())

  const rowsWithSliders = useMemo(() => {
    return rows.map((row) => {
      const rowSliders = sliders
        .filter((slider) => slider.row_id === row.id)
        .sort((a, b) => a.position - b.position)

      const average =
        rowSliders.length === 0
          ? 0
          : Math.round(
              rowSliders.reduce((sum, slider) => sum + clampValue(slider.value), 0) /
                rowSliders.length
            )

      return {
        ...row,
        sliders: rowSliders,
        average,
      }
    })
  }, [rows, sliders])

  useEffect(() => {
    localStorage.setItem('show-row-averages', String(showAverages))
  }, [showAverages])

  function setSliderValueLocally(sliderId, value) {
    const nextValue = clampValue(value)

    setSliders((prev) =>
      prev.map((slider) =>
        slider.id === sliderId ? { ...slider, value: nextValue } : slider
      )
    )
  }

  function setSliderLabelLocally(sliderId, label) {
    setSliders((prev) =>
      prev.map((slider) =>
        slider.id === sliderId ? { ...slider, label } : slider
      )
    )
  }

  function setSliderReversedLocally(sliderId, reversed) {
    setSliders((prev) =>
      prev.map((slider) =>
        slider.id === sliderId ? { ...slider, reversed } : slider
      )
    )
  }

  function setSliderTalkLocally(sliderId, talk) {
    setSliders((prev) =>
      prev.map((slider) =>
        slider.id === sliderId ? { ...slider, talk } : slider
      )
    )
  }

  function setRowNameLocally(rowId, name) {
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, name } : row
      )
    )
  }

  function setRowColorLocally(rowId, key, value) {
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, [key]: value } : row
      )
    )
  }

  function setRowWantToTalkLocally(rowId, wantToTalk) {
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, want_to_talk: wantToTalk } : row
      )
    )
  }

  function setRowTimestampLocally(rowId, timestamp) {
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, last_updated_at: timestamp } : row
      )
    )
  }

  function addRowLocally(row) {
    setRows((prev) => {
      if (prev.some((r) => r.id === row.id)) return prev
      return [...prev, row].sort((a, b) => a.position - b.position)
    })
  }

  function removeRowLocally(rowId) {
    setRows((prev) => prev.filter((row) => row.id !== rowId))
    setSliders((prev) => prev.filter((slider) => slider.row_id !== rowId))
  }

  function addSliderLocally(slider) {
    setSliders((prev) => {
      if (prev.some((s) => s.id === slider.id)) return prev
      return [...prev, slider].sort((a, b) => a.position - b.position)
    })
  }

  function removeSliderLocally(sliderId) {
    setSliders((prev) => prev.filter((slider) => slider.id !== sliderId))
  }

  function addNoteLocally(note) {
    setNotes((prev) => sortNewestFirst([note, ...prev.filter((n) => n.id !== note.id)]))
  }

  function removeNoteLocally(noteId) {
    setNotes((prev) => prev.filter((note) => note.id !== noteId))
  }

  async function loadBoardData(showLoading = true) {
    if (showLoading) {
      setLoading(true)
    }

    setError('')

    const { data: boardData, error: boardError } = await supabase
      .from('boards')
      .select('*')
      .eq('id', BOARD_ID)
      .single()

    if (boardError) {
      setError(boardError.message)
      if (showLoading) setLoading(false)
      return
    }

    const { data: rowData, error: rowError } = await supabase
      .from('rows')
      .select('*')
      .eq('board_id', BOARD_ID)
      .order('position', { ascending: true })

    if (rowError) {
      setError(rowError.message)
      if (showLoading) setLoading(false)
      return
    }

    const rowIds = (rowData || []).map((row) => row.id)

    let sliderData = []
    if (rowIds.length > 0) {
      const { data, error: sliderError } = await supabase
        .from('sliders')
        .select('*')
        .in('row_id', rowIds)
        .order('position', { ascending: true })

      if (sliderError) {
        setError(sliderError.message)
        if (showLoading) setLoading(false)
        return
      }

      sliderData = data || []
    }

    const { data: profileData, error: profileError } = await supabase
      .from('color_profiles')
      .select('*')
      .eq('board_id', BOARD_ID)
      .order('created_at', { ascending: true })

    if (profileError) {
      setError(profileError.message)
      if (showLoading) setLoading(false)
      return
    }

    const { data: notesData, error: notesError } = await supabase
      .from('notes')
      .select('*')
      .eq('board_id', BOARD_ID)
      .order('created_at', { ascending: false })

    if (notesError) {
      setError(notesError.message)
      if (showLoading) setLoading(false)
      return
    }

    setBoard(boardData)
    setRows(rowData || [])
    setSliders(sliderData)
    setProfiles(profileData || [])
    setNotes(notesData || [])

    if (showLoading) {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBoardData()
  }, [])

  useEffect(() => {
    const channel = supabase.channel(`board-live-${BOARD_ID}`)

    channel
      .on('broadcast', { event: 'board-title' }, ({ payload }) => {
        if (!payload || payload.senderId === clientIdRef.current) return
        setBoard((prev) => ({ ...(prev || {}), title: payload.title }))
      })
      .on('broadcast', { event: 'row-added' }, ({ payload }) => {
        if (!payload || payload.senderId === clientIdRef.current) return
        addRowLocally(payload.row)
      })
      .on('broadcast', { event: 'row-removed' }, ({ payload }) => {
        if (!payload || payload.senderId === clientIdRef.current) return
        removeRowLocally(payload.rowId)
      })
      .on('broadcast', { event: 'row-name' }, ({ payload }) => {
        if (!payload || payload.senderId === clientIdRef.current) return
        setRowNameLocally(payload.rowId, payload.name)
      })
      .on('broadcast', { event: 'row-color' }, ({ payload }) => {
        if (!payload || payload.senderId === clientIdRef.current) return
        setRowColorLocally(payload.rowId, payload.key, payload.value)
      })
      .on('broadcast', { event: 'row-want-to-talk' }, ({ payload }) => {
        if (!payload || payload.senderId === clientIdRef.current) return
        setRowWantToTalkLocally(payload.rowId, payload.wantToTalk)
      })
      .on('broadcast', { event: 'row-timestamp' }, ({ payload }) => {
        if (!payload || payload.senderId === clientIdRef.current) return
        setRowTimestampLocally(payload.rowId, payload.lastUpdatedAt)
      })
      .on('broadcast', { event: 'slider-added' }, ({ payload }) => {
        if (!payload || payload.senderId === clientIdRef.current) return
        addSliderLocally(payload.slider)
      })
      .on('broadcast', { event: 'slider-removed' }, ({ payload }) => {
        if (!payload || payload.senderId === clientIdRef.current) return
        removeSliderLocally(payload.sliderId)
      })
      .on('broadcast', { event: 'slider-label' }, ({ payload }) => {
        if (!payload || payload.senderId === clientIdRef.current) return
        setSliderLabelLocally(payload.sliderId, payload.label)
      })
      .on('broadcast', { event: 'slider-move' }, ({ payload }) => {
        if (!payload || payload.senderId === clientIdRef.current) return
        setSliderValueLocally(payload.sliderId, payload.value)
      })
      .on('broadcast', { event: 'slider-reversed' }, ({ payload }) => {
        if (!payload || payload.senderId === clientIdRef.current) return
        setSliderReversedLocally(payload.sliderId, payload.reversed)
      })
      .on('broadcast', { event: 'slider-talk' }, ({ payload }) => {
        if (!payload || payload.senderId === clientIdRef.current) return
        setSliderTalkLocally(payload.sliderId, payload.talk)
      })
      .on('broadcast', { event: 'note-added' }, ({ payload }) => {
        if (!payload || payload.senderId === clientIdRef.current) return
        addNoteLocally(payload.note)
      })
      .on('broadcast', { event: 'note-removed' }, ({ payload }) => {
        if (!payload || payload.senderId === clientIdRef.current) return
        removeNoteLocally(payload.noteId)
      })
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [])

  async function broadcastEvent(event, payload) {
    if (!channelRef.current) return

    await channelRef.current.send({
      type: 'broadcast',
      event,
      payload: {
        senderId: clientIdRef.current,
        ...payload,
      },
    })
  }

  async function saveBoardTitle(title) {
    const { error } = await supabase
      .from('boards')
      .update({ title })
      .eq('id', BOARD_ID)

    if (error) setError(error.message)
  }

  async function saveRowName(rowId, name) {
    const { error } = await supabase
      .from('rows')
      .update({ name })
      .eq('id', rowId)

    if (error) setError(error.message)
  }

  async function saveRowColor(rowId, key, value) {
    const { error } = await supabase
      .from('rows')
      .update({ [key]: value })
      .eq('id', rowId)

    if (error) setError(error.message)
  }

  async function saveRowWantToTalk(rowId, wantToTalk) {
    const { error } = await supabase
      .from('rows')
      .update({ want_to_talk: wantToTalk })
      .eq('id', rowId)

    if (error) setError(error.message)
  }

  async function saveRowTimestamp(rowId, timestamp) {
    const { error } = await supabase
      .from('rows')
      .update({ last_updated_at: timestamp })
      .eq('id', rowId)

    if (error) setError(error.message)
  }

  async function saveSliderLabel(sliderId, label) {
    const { error } = await supabase
      .from('sliders')
      .update({ label })
      .eq('id', sliderId)

    if (error) setError(error.message)
  }

  async function saveSliderValue(sliderId, value) {
    const safeValue = clampValue(value)

    const { error } = await supabase
      .from('sliders')
      .update({ value: safeValue })
      .eq('id', sliderId)

    if (error) setError(error.message)
  }

  async function saveSliderReversed(sliderId, reversed) {
    const { error } = await supabase
      .from('sliders')
      .update({ reversed })
      .eq('id', sliderId)

    if (error) setError(error.message)
  }

  async function saveSliderTalk(sliderId, talk) {
    const { error } = await supabase
      .from('sliders')
      .update({ talk })
      .eq('id', sliderId)

    if (error) setError(error.message)
  }

  async function runAndReload(work) {
    setSaving(true)
    setError('')

    try {
      const result = await work()
      if (result?.error) {
        setError(result.error.message)
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    }

    await loadBoardData(false)
    setSaving(false)
  }

  async function addRow() {
    const nextPosition = rows.length

    const { data, error } = await supabase
      .from('rows')
      .insert({
        board_id: BOARD_ID,
        name: `Row ${rows.length + 1}`,
        position: nextPosition,
        low_color: '#ef4444',
        medium_color: '#f59e0b',
        high_color: '#22c55e',
        want_to_talk: false,
      })
      .select()
      .single()

    if (error) {
      setError(error.message)
      return
    }

    addRowLocally(data)
    await broadcastEvent('row-added', { row: data })
  }

  async function removeRow(rowId) {
    const { error } = await supabase
      .from('rows')
      .delete()
      .eq('id', rowId)

    if (error) {
      setError(error.message)
      return
    }

    removeRowLocally(rowId)
    await broadcastEvent('row-removed', { rowId })
  }

  async function addSlider(row) {
    const rowSliders = sliders.filter((slider) => slider.row_id === row.id)
    const nextPosition = rowSliders.length

    const { data, error } = await supabase
      .from('sliders')
      .insert({
        row_id: row.id,
        label: `Slider ${row.position + 1}.${nextPosition + 1}`,
        value: 50,
        position: nextPosition,
        reversed: false,
        talk: false,
      })
      .select()
      .single()

    if (error) {
      setError(error.message)
      return
    }

    addSliderLocally(data)
    await broadcastEvent('slider-added', { slider: data })
  }

  async function removeSlider(sliderId) {
    const { error } = await supabase
      .from('sliders')
      .delete()
      .eq('id', sliderId)

    if (error) {
      setError(error.message)
      return
    }

    removeSliderLocally(sliderId)
    await broadcastEvent('slider-removed', { sliderId })
  }

  async function toggleSliderReversed(sliderId, currentValue) {
    const nextValue = !currentValue
    setSliderReversedLocally(sliderId, nextValue)
    await broadcastEvent('slider-reversed', {
      sliderId,
      reversed: nextValue,
    })
    await saveSliderReversed(sliderId, nextValue)
  }

  async function toggleSliderTalk(sliderId, currentValue) {
    const nextValue = !currentValue
    setSliderTalkLocally(sliderId, nextValue)
    await broadcastEvent('slider-talk', {
      sliderId,
      talk: nextValue,
    })
    await saveSliderTalk(sliderId, nextValue)
  }

  async function updateRowTimestampNow(rowId) {
    const now = new Date().toISOString()
    setRowTimestampLocally(rowId, now)
    await broadcastEvent('row-timestamp', {
      rowId,
      lastUpdatedAt: now,
    })
    await saveRowTimestamp(rowId, now)
  }

  async function postNote() {
    const content = noteDraft.trim()
    if (!content) return

    const { data, error } = await supabase
      .from('notes')
      .insert({
        board_id: BOARD_ID,
        content,
      })
      .select()
      .single()

    if (error) {
      setError(error.message)
      return
    }

    setNoteDraft('')
    addNoteLocally(data)
    await broadcastEvent('note-added', { note: data })
  }

  async function deleteNote(noteId) {
    const { error } = await supabase
      .from('notes')
      .delete()
      .eq('id', noteId)

    if (error) {
      setError(error.message)
      return
    }

    removeNoteLocally(noteId)
    await broadcastEvent('note-removed', { noteId })
  }

  async function savePalette(row) {
    await runAndReload(() =>
      supabase
        .from('color_profiles')
        .insert({
          board_id: BOARD_ID,
          name: row.name || 'Palette',
          low_color: row.low_color,
          medium_color: row.medium_color,
          high_color: row.high_color,
        })
    )
  }

  async function renamePalette(profileId, name) {
    await runAndReload(() =>
      supabase
        .from('color_profiles')
        .update({ name })
        .eq('id', profileId)
    )
  }

  async function deletePalette(profileId) {
    await runAndReload(() =>
      supabase
        .from('color_profiles')
        .delete()
        .eq('id', profileId)
    )
  }

  async function applyPaletteToRow(rowId, profileId) {
    const profile = profiles.find((p) => p.id === profileId)
    if (!profile) return

    await runAndReload(() =>
      supabase
        .from('rows')
        .update({
          low_color: profile.low_color,
          medium_color: profile.medium_color,
          high_color: profile.high_color,
        })
        .eq('id', rowId)
    )
  }

  return (
    <div style={styles.page}>
      <style>{`
        * { box-sizing: border-box; }

        .hover-edit {
          border: 1px solid transparent;
          background: transparent;
          color: white;
          border-radius: 12px;
          outline: none;
          transition: 0.15s ease;
        }

        .hover-edit:hover,
        .hover-edit:focus {
          background: rgba(255,255,255,0.08);
          border-color: rgba(255,255,255,0.12);
        }

        .select-soft,
        .input-soft,
        .button-soft,
        .button-danger {
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.06);
          color: white;
        }

        .input-soft,
        .select-soft {
          padding: 10px 12px;
          outline: none;
        }

        .button-soft,
        .button-danger {
          padding: 10px 14px;
          cursor: pointer;
        }

        .button-soft:hover,
        .select-soft:hover,
        .input-soft:hover {
          background: rgba(255,255,255,0.1);
        }

        .button-danger:hover {
          background: rgba(255,80,80,0.18);
        }

        .slider-vertical {
          writing-mode: vertical-lr;
          direction: rtl;
          width: 22px;
          height: 180px;
          cursor: pointer;
          accent-color: var(--slider-color);
        }

        .slider-vertical::-webkit-slider-runnable-track {
          background: var(--slider-color);
          border-radius: 999px;
          width: 16px;
        }

        .slider-vertical::-moz-range-track {
          background: var(--slider-color);
          border-radius: 999px;
          width: 16px;
        }

        .slider-vertical::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: white;
          border: 2px solid rgba(0,0,0,0.35);
        }

        .slider-vertical::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: white;
          border: 2px solid rgba(0,0,0,0.35);
        }

        @media (max-width: 1280px) {
          .slider-grid-fixed {
            grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
          }
        }

        @media (max-width: 900px) {
          .app-shell {
            grid-template-columns: 1fr !important;
          }

          .slider-grid-fixed {
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
          }
        }

        @media (max-width: 640px) {
          .slider-grid-fixed {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
      `}</style>

      <div className="app-shell" style={styles.appShell}>
        <div style={styles.mainColumn}>
          <div style={styles.topCard}>
            <div>
              <input
                className="hover-edit"
                style={styles.boardTitle}
                value={board?.title || ''}
                onChange={async (e) => {
                  const title = e.target.value
                  setBoard((prev) => ({ ...(prev || {}), title }))
                  await broadcastEvent('board-title', { title })
                }}
                onBlur={(e) => saveBoardTitle(e.target.value)}
                placeholder="Board title"
              />

              <div style={styles.metaRow}>
                <div style={styles.metaPill}>Rows: {rows.length}</div>
                <div style={styles.metaPill}>Sliders: {sliders.length}</div>
                <div style={styles.metaPill}>Palettes: {profiles.length}</div>
                <div style={styles.metaPill}>Notes: {notes.length}</div>
                {saving && <div style={styles.metaPill}>Saving...</div>}
              </div>
            </div>

            <div style={styles.actionRow}>
              <button className="button-soft" onClick={addRow}>Add row</button>
              <button
                className="button-soft"
                onClick={() => setShowAverages((prev) => !prev)}
              >
                {showAverages ? 'Hide averages' : 'Show averages'}
              </button>
              <button className="button-soft" onClick={() => loadBoardData(true)}>Refresh</button>
            </div>
          </div>

          {error && (
            <div style={styles.errorBox}>
              {error}
            </div>
          )}

          {loading ? (
            <div style={styles.emptyCard}>Loading board...</div>
          ) : (
            <>
              {rowsWithSliders.length === 0 ? (
                <div style={styles.emptyCard}>
                  No rows yet. Click <strong>Add row</strong> to make your first one.
                </div>
              ) : (
                rowsWithSliders.map((row) => (
                  <div key={row.id} style={styles.rowCard}>
                    <div style={styles.rowHeader}>
                      <div style={styles.rowHeaderTop}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <input
                            className="hover-edit"
                            style={styles.rowTitle}
                            value={row.name}
                            onChange={async (e) => {
                              const name = e.target.value
                              setRowNameLocally(row.id, name)
                              await broadcastEvent('row-name', { rowId: row.id, name })
                            }}
                            onBlur={(e) => saveRowName(row.id, e.target.value)}
                          />

                          {showAverages && (
                            <div style={styles.averagePill}>
                              Average: {row.average}
                            </div>
                          )}
                        </div>

                        <div style={styles.actionRow}>
                          <button className="button-soft" onClick={() => addSlider(row)}>Add slider</button>
                          <button className="button-soft" onClick={() => savePalette(row)}>Save palette</button>
                          <button className="button-danger" onClick={() => removeRow(row.id)}>Remove row</button>
                        </div>
                      </div>

                      <div style={styles.timestampRow}>
                        <div style={styles.timestampText}>
                          Last updated at: {formatTimestamp(row.last_updated_at)}
                        </div>
                        <button className="button-soft" onClick={() => updateRowTimestampNow(row.id)}>
                          Update timestamp
                        </button>
                      </div>

                      <div style={styles.talkToggleRow}>
                        <span style={styles.talkToggleLabel}>Want to talk?</span>

                        <button
                          className="button-soft"
                          style={{
                            ...styles.talkToggleButton,
                            background: row.want_to_talk ? 'rgba(34,197,94,0.22)' : 'rgba(255,255,255,0.06)',
                            borderColor: row.want_to_talk ? 'rgba(34,197,94,0.45)' : 'rgba(255,255,255,0.12)',
                          }}
                          onClick={async () => {
                            const nextValue = !row.want_to_talk
                            setRowWantToTalkLocally(row.id, nextValue)
                            await broadcastEvent('row-want-to-talk', {
                              rowId: row.id,
                              wantToTalk: nextValue,
                            })
                            await saveRowWantToTalk(row.id, nextValue)
                          }}
                          title="Toggle want to talk"
                        >
                          <div
                            style={{
                              ...styles.talkToggleKnob,
                              transform: row.want_to_talk ? 'translateX(24px)' : 'translateX(0px)',
                            }}
                          />
                        </button>
                      </div>

                      <div style={styles.paletteControls}>
                        <label style={styles.colorLabel}>
                          <span>Low</span>
                          <input
                            type="color"
                            value={row.low_color}
                            onChange={async (e) => {
                              setRowColorLocally(row.id, 'low_color', e.target.value)
                              await broadcastEvent('row-color', {
                                rowId: row.id,
                                key: 'low_color',
                                value: e.target.value,
                              })
                              await saveRowColor(row.id, 'low_color', e.target.value)
                            }}
                          />
                        </label>

                        <label style={styles.colorLabel}>
                          <span>Medium</span>
                          <input
                            type="color"
                            value={row.medium_color}
                            onChange={async (e) => {
                              setRowColorLocally(row.id, 'medium_color', e.target.value)
                              await broadcastEvent('row-color', {
                                rowId: row.id,
                                key: 'medium_color',
                                value: e.target.value,
                              })
                              await saveRowColor(row.id, 'medium_color', e.target.value)
                            }}
                          />
                        </label>

                        <label style={styles.colorLabel}>
                          <span>High</span>
                          <input
                            type="color"
                            value={row.high_color}
                            onChange={async (e) => {
                              setRowColorLocally(row.id, 'high_color', e.target.value)
                              await broadcastEvent('row-color', {
                                rowId: row.id,
                                key: 'high_color',
                                value: e.target.value,
                              })
                              await saveRowColor(row.id, 'high_color', e.target.value)
                            }}
                          />
                        </label>

                        <div style={{ marginLeft: 'auto', minWidth: 220 }}>
                          <div style={styles.smallLabel}>Apply saved palette</div>
                          <select
                            className="select-soft"
                            defaultValue=""
                            onChange={(e) => {
                              if (!e.target.value) return
                              applyPaletteToRow(row.id, e.target.value)
                              e.target.value = ''
                            }}
                            style={{ width: '100%' }}
                          >
                            <option value="">Choose a palette...</option>
                            {profiles.map((profile) => (
                              <option key={profile.id} value={profile.id}>
                                {profile.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="slider-grid-fixed" style={styles.sliderGrid}>
                      {row.sliders.map((slider) => {
                        const rowColors = {
                          low_color: row.low_color,
                          medium_color: row.medium_color,
                          high_color: row.high_color,
                        }

                        const sliderColor = valueToColor(slider.value, rowColors, slider.reversed)

                        return (
                          <div key={slider.id} style={styles.sliderCard}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                              <button
                                className="button-soft"
                                style={styles.iconButton}
                                onClick={async () => {
                                  setSliderValueLocally(slider.id, 50)
                                  await broadcastEvent('slider-move', {
                                    sliderId: slider.id,
                                    value: 50,
                                  })
                                  await saveSliderValue(slider.id, 50)
                                }}
                                title="Reset slider"
                              >
                                ↺
                              </button>

                              <button
                                className="button-danger"
                                style={styles.iconButton}
                                onClick={() => removeSlider(slider.id)}
                                title="Remove slider"
                              >
                                ×
                              </button>
                            </div>

                            <div style={styles.sliderWrap}>
                              <input
                                className="slider-vertical"
                                type="range"
                                min="0"
                                max="100"
                                value={slider.value}
                                onChange={async (e) => {
                                  const nextValue = clampValue(e.target.value)
                                  setSliderValueLocally(slider.id, nextValue)
                                  await broadcastEvent('slider-move', {
                                    sliderId: slider.id,
                                    value: nextValue,
                                  })
                                }}
                                onMouseUp={(e) => saveSliderValue(slider.id, e.target.value)}
                                onTouchEnd={(e) => saveSliderValue(slider.id, e.target.value)}
                                style={{ '--slider-color': sliderColor }}
                              />
                            </div>

                            <div
                              style={{
                                ...styles.colorBar,
                                background: sliderColor,
                                boxShadow: `0 0 18px ${sliderColor}`,
                              }}
                            />

                            <div style={styles.sliderLabelRow}>
                              <input
                                className="hover-edit"
                                style={styles.sliderLabel}
                                value={slider.label}
                                onChange={async (e) => {
                                  const label = e.target.value
                                  setSliderLabelLocally(slider.id, label)
                                  await broadcastEvent('slider-label', {
                                    sliderId: slider.id,
                                    label,
                                  })
                                }}
                                onBlur={(e) => saveSliderLabel(slider.id, e.target.value)}
                              />

                              <button
                                className="button-soft"
                                style={styles.reverseButton}
                                onClick={() => toggleSliderReversed(slider.id, !!slider.reversed)}
                                title="Reverse gradient"
                              >
                                {slider.reversed ? '⇄' : '↔'}
                              </button>
                            </div>

                            <div style={styles.valueRow}>
                              <span style={styles.smallLabel}>Value</span>
                              <input
                                className="input-soft"
                                type="number"
                                min="0"
                                max="100"
                                value={slider.value}
                                onChange={async (e) => {
                                  const nextValue = clampValue(e.target.value)
                                  setSliderValueLocally(slider.id, nextValue)
                                  await broadcastEvent('slider-move', {
                                    sliderId: slider.id,
                                    value: nextValue,
                                  })
                                }}
                                onBlur={(e) => saveSliderValue(slider.id, e.target.value)}
                                style={{ width: 80, textAlign: 'center' }}
                              />
                            </div>

                            <div style={styles.sliderTalkRow}>
                              <span style={styles.smallLabel}>Talk?</span>
                              <button
                                className="button-soft"
                                style={{
                                  ...styles.smallTalkToggleButton,
                                  background: slider.talk ? 'rgba(34,197,94,0.22)' : 'rgba(255,255,255,0.06)',
                                  borderColor: slider.talk ? 'rgba(34,197,94,0.45)' : 'rgba(255,255,255,0.12)',
                                }}
                                onClick={() => toggleSliderTalk(slider.id, !!slider.talk)}
                                title="Toggle talk"
                              >
                                <div
                                  style={{
                                    ...styles.smallTalkToggleKnob,
                                    transform: slider.talk ? 'translateX(18px)' : 'translateX(0px)',
                                  }}
                                />
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              )}

              <div style={styles.savedProfilesCard}>
                <div style={styles.sectionTitle}>Saved Color Profiles</div>

                {profiles.length === 0 ? (
                  <div style={styles.smallMuted}>No saved palettes yet.</div>
                ) : (
                  <div style={styles.profileGrid}>
                    {profiles.map((profile) => (
                      <div key={profile.id} style={styles.profileCard}>
                        <div style={styles.profileTop}>
                          <input
                            className="hover-edit"
                            style={styles.profileName}
                            value={profile.name}
                            onChange={(e) => {
                              setProfiles((prev) =>
                                prev.map((p) => p.id === profile.id ? { ...p, name: e.target.value } : p)
                              )
                            }}
                            onBlur={(e) => renamePalette(profile.id, e.target.value)}
                          />

                          <button
                            className="button-danger"
                            style={styles.iconButton}
                            onClick={() => deletePalette(profile.id)}
                            title="Delete palette"
                          >
                            ×
                          </button>
                        </div>

                        <div style={styles.profileSwatches}>
                          <div style={{ ...styles.swatch, background: profile.low_color }} />
                          <div style={{ ...styles.swatch, background: profile.medium_color }} />
                          <div style={{ ...styles.swatch, background: profile.high_color }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <aside style={styles.notesSidebar}>
          <div style={styles.notesHeader}>Little notes</div>
          <div style={styles.notesSubheader}>Tiny journal entries for when the other one isn’t around.</div>

          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Write a little note..."
            style={styles.noteComposer}
          />

          <button className="button-soft" onClick={postNote} style={styles.postNoteButton}>
            Post entry
          </button>

          <div style={styles.notesList}>
            {notes.length === 0 ? (
              <div style={styles.notesEmpty}>
                No notes yet :3
              </div>
            ) : (
              notes.map((note, index) => (
                <div
                  key={note.id}
                  style={{
                    ...styles.noteCard,
                    transform: `rotate(${(index % 2 === 0 ? -1 : 1) * 0.8}deg)`,
                  }}
                >
                  <div style={styles.noteTimestamp}>{formatTimestamp(note.created_at)}</div>
                  <div style={styles.noteContent}>{note.content}</div>
                  <div style={styles.noteFooter}>
                    <button
                      className="button-danger"
                      onClick={() => deleteNote(note.id)}
                      style={styles.noteDeleteButton}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #09090b 0%, #111827 50%, #000000 100%)',
    color: 'white',
    padding: 24,
    fontFamily: 'Arial, sans-serif',
  },
  appShell: {
    maxWidth: 1900,
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 360px',
    gap: 20,
    alignItems: 'start',
  },
  mainColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    minWidth: 0,
  },
  notesSidebar: {
    position: 'sticky',
    top: 24,
    borderRadius: 28,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.06)',
    backdropFilter: 'blur(10px)',
    padding: 18,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    minHeight: 300,
  },
  notesHeader: {
    fontSize: 24,
    fontWeight: 700,
    color: '#fef3c7',
  },
  notesSubheader: {
    fontSize: 13,
    color: '#d4d4d8',
    lineHeight: 1.5,
  },
  noteComposer: {
    minHeight: 120,
    resize: 'vertical',
    borderRadius: 18,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,248,196,0.08)',
    color: '#fff8dc',
    padding: 14,
    outline: 'none',
    fontSize: 18,
    lineHeight: 1.45,
    fontFamily: '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive',
  },
  postNoteButton: {
    alignSelf: 'flex-start',
  },
  notesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    marginTop: 4,
  },
  notesEmpty: {
    padding: 18,
    borderRadius: 18,
    border: '1px dashed rgba(255,255,255,0.18)',
    color: '#d4d4d8',
    background: 'rgba(255,255,255,0.04)',
  },
  noteCard: {
    background: '#fef08a',
    color: '#3f2f0a',
    borderRadius: 16,
    padding: 14,
    boxShadow: '0 12px 28px rgba(0,0,0,0.24)',
    border: '1px solid rgba(255, 237, 160, 0.65)',
  },
  noteTimestamp: {
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 8,
    color: '#6b4f0d',
  },
  noteContent: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: 20,
    lineHeight: 1.45,
    fontFamily: '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive',
  },
  noteFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: 12,
  },
  noteDeleteButton: {
    padding: '6px 10px',
    fontSize: 12,
  },
  topCard: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 20,
    alignItems: 'flex-start',
    padding: 24,
    borderRadius: 28,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.06)',
    backdropFilter: 'blur(10px)',
  },
  boardTitle: {
    fontSize: 32,
    fontWeight: 700,
    padding: '8px 12px',
    minWidth: 280,
  },
  metaRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  metaPill: {
    padding: '8px 12px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(0,0,0,0.24)',
    fontSize: 14,
    color: '#d4d4d8',
  },
  timestampRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
  },
  timestampText: {
    padding: '8px 12px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(0,0,0,0.24)',
    fontSize: 14,
    color: '#d4d4d8',
  },
  averagePill: {
    alignSelf: 'flex-start',
    padding: '8px 12px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(0,0,0,0.24)',
    fontSize: 14,
    color: '#d4d4d8',
  },
  actionRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
  },
  rowCard: {
    borderRadius: 28,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.06)',
    backdropFilter: 'blur(10px)',
    overflow: 'hidden',
  },
  rowHeader: {
    padding: 20,
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  rowHeaderTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
  },
  rowTitle: {
    fontSize: 22,
    fontWeight: 700,
    padding: '8px 12px',
    minWidth: 180,
  },
  talkToggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '0 4px',
  },
  talkToggleLabel: {
    fontSize: 15,
    color: '#e4e4e7',
    fontWeight: 600,
  },
  talkToggleButton: {
    width: 56,
    height: 32,
    padding: 4,
    borderRadius: 999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    transition: '0.15s ease',
  },
  talkToggleKnob: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: 'white',
    transition: '0.15s ease',
  },
  paletteControls: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
    alignItems: 'end',
    borderRadius: 20,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(0,0,0,0.2)',
    padding: 16,
  },
  colorLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: '#d4d4d8',
    fontSize: 14,
  },
  sliderGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
    gap: 16,
    padding: 20,
  },
  sliderCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    borderRadius: 22,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.05)',
    padding: 14,
    minWidth: 0,
  },
  sliderWrap: {
    height: 210,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorBar: {
    height: 12,
    width: 60,
    borderRadius: 999,
    transition: '0.15s ease',
  },
  sliderLabelRow: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  sliderLabel: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    padding: '8px 10px',
    fontSize: 14,
  },
  reverseButton: {
    width: 40,
    height: 40,
    padding: 0,
    flexShrink: 0,
    fontSize: 16,
  },
  valueRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  sliderTalkRow: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 2,
  },
  smallTalkToggleButton: {
    width: 46,
    height: 28,
    padding: 4,
    borderRadius: 999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    transition: '0.15s ease',
  },
  smallTalkToggleKnob: {
    width: 16,
    height: 16,
    borderRadius: '50%',
    background: 'white',
    transition: '0.15s ease',
  },
  smallLabel: {
    fontSize: 13,
    color: '#d4d4d8',
  },
  savedProfilesCard: {
    borderRadius: 28,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.06)',
    backdropFilter: 'blur(10px)',
    padding: 20,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 16,
  },
  smallMuted: {
    color: '#a1a1aa',
  },
  profileGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: 14,
  },
  profileCard: {
    borderRadius: 20,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(0,0,0,0.18)',
    padding: 14,
  },
  profileTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  profileName: {
    flex: 1,
    padding: '8px 10px',
    fontSize: 15,
    fontWeight: 600,
  },
  profileSwatches: {
    display: 'flex',
    gap: 8,
  },
  swatch: {
    height: 36,
    flex: 1,
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.12)',
  },
  iconButton: {
    width: 34,
    height: 34,
    padding: 0,
    fontSize: 18,
    lineHeight: 1,
  },
  errorBox: {
    padding: 14,
    borderRadius: 18,
    background: 'rgba(255,80,80,0.14)',
    border: '1px solid rgba(255,80,80,0.25)',
    color: '#fecaca',
  },
  emptyCard: {
    padding: 24,
    borderRadius: 24,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.05)',
    color: '#d4d4d8',
  },
}