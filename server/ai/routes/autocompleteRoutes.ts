import { Router } from "express";

const router = Router();

// Debounce cache to avoid hammering Nominatim
const cache = new Map<string, { data: any; expires: number }>();
const CACHE_TTL = 60000; // 1 minute

// GET /api/autocomplete?q=123+main+st
router.get("/", async (req, res) => {
  try {
    const query = (req.query.q as string || "").trim();
    if (query.length < 3) {
      res.json([]);
      return;
    }

    // Check cache
    const cached = cache.get(query);
    if (cached && cached.expires > Date.now()) {
      res.json(cached.data);
      return;
    }

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "5");
    url.searchParams.set("countrycodes", "us");

    const response = await fetch(url.toString(), {
      headers: { "User-Agent": "PropertyExteriorAnalyzer/1.0" },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      // Rate limited — return empty, frontend will show "type full address"
      res.json([]);
      return;
    }

    const text = await response.text();
    // Nominatim returns HTML on rate limit instead of JSON
    if (!text.startsWith("[")) {
      res.json([]);
      return;
    }

    const data = JSON.parse(text);
    const suggestions = data
      .filter((item: any) => item.address?.house_number && item.address?.road)
      .map((item: any) => ({
        display: item.display_name,
        address: [
          `${item.address.house_number} ${item.address.road}`,
          item.address.city || item.address.town || item.address.village || "",
          item.address.state || "",
          item.address.postcode || "",
        ]
          .filter(Boolean)
          .join(", "),
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
      }));

    cache.set(query, { data: suggestions, expires: Date.now() + CACHE_TTL });

    // Clean old cache entries
    if (cache.size > 200) {
      const now = Date.now();
      for (const [k, v] of cache) {
        if (v.expires < now) cache.delete(k);
      }
    }

    res.json(suggestions);
  } catch {
    res.json([]);
  }
});

export default router;
