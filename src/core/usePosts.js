import { useState, useEffect, useCallback } from 'react'

import { API } from './api.js'
const POLL_MS = 15000

export function usePosts() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)

  const addPost = useCallback(async (post) => {
    setPosts((prev) => [...prev, post])           // optimistic
    try {
      await fetch(`${API}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(post),
      })
    } catch (err) {
      console.error('Failed to save post:', err)
    }
  }, [])

  const updatePost = useCallback(async (id, changes) => {
    try {
      const res = await fetch(`${API}/posts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`)
      const updated = await res.json()
      setPosts((prev) => prev.map((p) => (p.id === id ? updated : p)))
    } catch (err) {
      console.error('Failed to update post:', err)
    }
  }, [])

  const deletePost = useCallback(async (id) => {
    try {
      await fetch(`${API}/posts/${id}`, { method: 'DELETE' })
      setPosts((prev) => prev.filter((p) => p.id !== id))
    } catch (err) {
      console.error('Failed to delete post:', err)
    }
  }, [])

  const refreshMetrics = useCallback(async () => {
    try {
      const res = await fetch(`${API}/metrics/refresh`, { method: 'POST' })
      const data = await res.json()
      setPosts(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to refresh metrics:', err)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      try {
        const res = await fetch(`${API}/posts`)
        const server = await res.json()
        if (!Array.isArray(server)) return
        if (cancelled) return
        setPosts((prev) => {
          // Server is source of truth; keep local-only posts still in flight.
          const ids = new Set(server.map((p) => p.id))
          const localOnly = prev.filter((p) => !ids.has(p.id))
          return [...server, ...localOnly]
        })
      } catch (err) {
        console.error('Failed to load posts:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    refresh()
    const id = setInterval(() => { if (!document.hidden) refresh() }, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return { posts, addPost, updatePost, deletePost, refreshMetrics, loading }}