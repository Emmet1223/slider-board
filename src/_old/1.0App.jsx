import { useEffect, useMemo, useState } from 'react'
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

function valueToColor(value, colors) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0))

  if (safe <= 50) {
    return mixColors(colors.low_color, colors.medium_color, safe / 50)
  }

  return mixColors(colors.medium_color, colors.high_color, (safe - 50) / 50)
}

function clampValue(value) {
  return Math.max(0, Math.min(100, Number(value) || 0))
}

export default function App() {
  const [board, setBoard] = useState(null)
  const [rows, setRows] = useState([])
  const [sliders, setSliders] = useState([])
  const [profiles, setProfiles] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const rowsWithSliders = useMemo(() => {
    return rows.map((row) => ({
      ...row,
      sliders: sliders
        .filter((slider) => slider.row_id === row.id)
        .sort((a, b) => a.position - b.position),
    }))
  }, [rows, sliders])

  async function loadBoardData() {
    setLoading(true)
    setError('')

    const { data: boardData, error: boardError } = await supabase
      .from('boards')
      .select('*')
      .eq('id', BOARD_ID)
      .single()

    if (boardError) {
      setError(boardError.message)
      setLoading(false)
      return
    }

    const { data: rowData, error: rowError } = await supabase
      .from('rows')
      .select('*')
      .eq('board_id', BOARD_ID)
      .order('position', { ascending: true })

    if (rowError) {
      setError(rowError.message)
      setLoading(false)
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
        setLoading(false)
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
      setLoading(false)
      return
    }

    setBoard(boardData)
    setRows(rowData || [])
    setSliders(sliderData)
    setProfiles(profileData || [])
    setLoading(false)
  }

  useEffect(() => {
    loadBoardData()
  }, [])

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

    await loadBoardData()
    setSaving(false)
  }

  async function updateBoardTitle(title) {
    await runAndReload(() =>
      supabase
        .from('boards')
        .update({ title })
        .eq('id', BOARD_ID)
    )
  }

  async function addRow() {
    const nextPosition = rows.length

    await runAndReload(() =>
      supabase
        .from('rows')
        .insert({
          board_id: BOARD_ID,
          name: `Row ${rows.length + 1}`,
          position: nextPosition,
          low_color: '#ef4444',
          medium_color: '#f59e0b',
          high_color: '#22c55e',
        })
    )
  }

  async function removeRow(rowId) {
    await runAndReload(() =>
      supabase
        .from('rows')
        .delete()
        .eq('id', rowId)
    )
  }

  async function updateRowName(rowId, name) {
    await runAndReload(() =>
      supabase
        .from('rows')
        .update({ name })
        .eq('id', rowId)
    )
  }

  async function updateRowColor(rowId, key, value) {
    await runAndReload(() =>
      supabase
        .from('rows')
        .update({ [key]: value })
        .eq('id', rowId)
    )
  }

  async function addSlider(row) {
    const rowSliders = sliders.filter((slider) => slider.row_id === row.id)
    const nextPosition = rowSliders.length

    await runAndReload(() =>
      supabase
        .from('sliders')
        .insert({
          row_id: row.id,
          label: `Slider ${row.position + 1}.${nextPosition + 1}`,
          value: 50,
          position: nextPosition,
        })
    )
  }

  async function removeSlider(sliderId) {
    await runAndReload(() =>
      supabase
        .from('sliders')
        .delete()
        .eq('id', sliderId)
    )
  }

  async function updateSliderLabel(sliderId, label) {
    await runAndReload(() =>
      supabase
        .from('sliders')
        .update({ label })
        .eq('id', sliderId)
    )
  }

  async function updateSliderValue(sliderId, value) {
    await runAndReload(() =>
      supabase
        .from('sliders')
        .update({ value: clampValue(value) })
        .eq('id', sliderId)
    )
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
      `}</style>

      <div style={styles.container}>
        <div style={styles.topCard}>
          <div>
            <input
              className="hover-edit"
              style={styles.boardTitle}
              value={board?.title || ''}
              onChange={(e) => setBoard((prev) => ({ ...(prev || {}), title: e.target.value }))}
              onBlur={(e) => updateBoardTitle(e.target.value)}
              placeholder="Board title"
            />

            <div style={styles.metaRow}>
              <div style={styles.metaPill}>Rows: {rows.length}</div>
              <div style={styles.metaPill}>Sliders: {sliders.length}</div>
              <div style={styles.metaPill}>Palettes: {profiles.length}</div>
              {saving && <div style={styles.metaPill}>Saving...</div>}
            </div>
          </div>

          <div style={styles.actionRow}>
            <button className="button-soft" onClick={addRow}>Add row</button>
            <button className="button-soft" onClick={loadBoardData}>Refresh</button>
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
                      <input
                        className="hover-edit"
                        style={styles.rowTitle}
                        value={row.name}
                        onChange={(e) => {
                          setRows((prev) =>
                            prev.map((r) => r.id === row.id ? { ...r, name: e.target.value } : r)
                          )
                        }}
                        onBlur={(e) => updateRowName(row.id, e.target.value)}
                      />

                      <div style={styles.actionRow}>
                        <button className="button-soft" onClick={() => addSlider(row)}>Add slider</button>
                        <button className="button-soft" onClick={() => savePalette(row)}>Save palette</button>
                        <button className="button-danger" onClick={() => removeRow(row.id)}>Remove row</button>
                      </div>
                    </div>

                    <div style={styles.paletteControls}>
                      <label style={styles.colorLabel}>
                        <span>Low</span>
                        <input
                          type="color"
                          value={row.low_color}
                          onChange={(e) => updateRowColor(row.id, 'low_color', e.target.value)}
                        />
                      </label>

                      <label style={styles.colorLabel}>
                        <span>Medium</span>
                        <input
                          type="color"
                          value={row.medium_color}
                          onChange={(e) => updateRowColor(row.id, 'medium_color', e.target.value)}
                        />
                      </label>

                      <label style={styles.colorLabel}>
                        <span>High</span>
                        <input
                          type="color"
                          value={row.high_color}
                          onChange={(e) => updateRowColor(row.id, 'high_color', e.target.value)}
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

                  <div style={styles.sliderGrid}>
                    {row.sliders.map((slider) => {
                      const rowColors = {
                        low_color: row.low_color,
                        medium_color: row.medium_color,
                        high_color: row.high_color,
                      }

                      const sliderColor = valueToColor(slider.value, rowColors)

                      return (
                        <div key={slider.id} style={styles.sliderCard}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
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
                              onChange={(e) => {
                                const nextValue = clampValue(e.target.value)
                                setSliders((prev) =>
                                  prev.map((s) => s.id === slider.id ? { ...s, value: nextValue } : s)
                                )
                              }}
                              onMouseUp={(e) => updateSliderValue(slider.id, e.target.value)}
                              onTouchEnd={(e) => updateSliderValue(slider.id, e.target.value)}
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

                          <input
                            className="hover-edit"
                            style={styles.sliderLabel}
                            value={slider.label}
                            onChange={(e) => {
                              setSliders((prev) =>
                                prev.map((s) => s.id === slider.id ? { ...s, label: e.target.value } : s)
                              )
                            }}
                            onBlur={(e) => updateSliderLabel(slider.id, e.target.value)}
                          />

                          <div style={styles.valueRow}>
                            <span style={styles.smallLabel}>Value</span>
                            <input
                              className="input-soft"
                              type="number"
                              min="0"
                              max="100"
                              value={slider.value}
                              onChange={(e) => {
                                const nextValue = clampValue(e.target.value)
                                setSliders((prev) =>
                                  prev.map((s) => s.id === slider.id ? { ...s, value: nextValue } : s)
                                )
                              }}
                              onBlur={(e) => updateSliderValue(slider.id, e.target.value)}
                              style={{ width: 80, textAlign: 'center' }}
                            />
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
  container: {
    maxWidth: 1300,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
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
    gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
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
  sliderLabel: {
    width: '100%',
    textAlign: 'center',
    padding: '8px 10px',
    fontSize: 14,
  },
  valueRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
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