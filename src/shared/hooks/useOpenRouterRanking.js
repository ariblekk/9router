"use client";

import { useState, useEffect } from "react";

const CACHE_KEY = "or_ranking_cache";
const CACHE_TTL = 3600000; // 1 hour

let memCache = null;
let inflight = null;

function normalize(id) {
  return id.toLowerCase().replace(/:free$|:batch$|:nitro$|:extended$/,"").replace(/[^a-z0-9]/g,"");
}

async function fetchRanking() {
  if (memCache) return memCache;
  if (inflight) return inflight;

  // Try localStorage first
  const cached = typeof window !== "undefined" ? localStorage.getItem(CACHE_KEY) : null;
  if (cached) {
    try {
      const { data, ts } = JSON.parse(cached);
      if (Date.now() - ts < CACHE_TTL) {
        memCache = data;
        return data;
      }
    } catch {}
  }

  inflight = fetch("https://openrouter.ai/api/v1/models")
    .then(async (res) => {
      if (!res.ok) throw new Error(`OR ${res.status}`);
      const json = await res.json();
      const models = json.data || [];
      
      const byNorm = new Map();
      for (const m of models) {
        if (!m.benchmarks?.artificial_analysis) continue;
        const bare = m.id.includes("/") ? m.id.split("/").slice(1).join("/") : m.id;
        const k = normalize(bare);
        const aa = m.benchmarks.artificial_analysis;
        const entry = { id: m.id, coding: aa.coding_index, reasoning: aa.agentic_index, intelligence: aa.intelligence_index };
        if (!byNorm.has(k) || (entry.coding || 0) > (byNorm.get(k).coding || 0)) {
          byNorm.set(k, entry);
        }
      }
      
      const result = { byNorm, ts: Date.now() };
      memCache = result;
      if (typeof window !== "undefined") {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ data: { byNorm: Array.from(byNorm.entries()), ts: result.ts }, ts: result.ts }));
      }
      return result;
    })
    .catch((err) => {
      console.warn("Failed to fetch OpenRouter ranking:", err);
      return { byNorm: new Map(), ts: Date.now() };
    })
    .finally(() => { inflight = null; });

  return inflight;
}

export function useOpenRouterRanking() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchRanking().then((d) => {
      if (alive) {
        const map = d.byNorm instanceof Map ? d.byNorm : new Map(d.byNorm);
        setData({ byNorm: map, ts: d.ts });
      }
    });
    return () => { alive = false; };
  }, []);

  const rankModels = (models, category) => {
    if (!data?.byNorm) return [];
    const field = category === "coding" ? "coding" : category === "reasoning" ? "reasoning" : "intelligence";
    const scored = models
      .map((m) => {
        const k = normalize(m.id || m.model || "");
        const entry = data.byNorm.get(k);
        return { ...m, score: entry?.[field] || null };
      })
      .filter((m) => m.score !== null)
      .sort((a, b) => b.score - a.score);
    return scored;
  };

  return { rankModels, ready: !!data };
}
