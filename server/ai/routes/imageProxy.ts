import { Router } from "express";
import { db } from "../../db.js";
import { getStoredImages, getStoredImage } from "../services/imageStorageService.js";

const router = Router();

// GET /api/images/streetview?lat=...&lng=...
// Proxies Google Street View image so API key isn't exposed to frontend
router.get("/streetview", async (req, res) => {
  try {
    const lat = req.query.lat as string;
    const lng = req.query.lng as string;
    const pitch = req.query.pitch || "20";
    const fov = req.query.fov || "80";

    if (!lat || !lng) {
      res.status(400).json({ error: "lat and lng required" });
      return;
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "API key not configured" });
      return;
    }

    const url = `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${lat},${lng}&pitch=${pitch}&fov=${fov}&scale=2&key=${apiKey}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });

    if (!response.ok) {
      res.status(response.status).end();
      return;
    }

    res.setHeader("Content-Type", response.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400"); // Cache 24h
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch {
    res.status(500).end();
  }
});

// GET /api/images/satellite?lat=...&lng=...&zoom=20
router.get("/satellite", async (req, res) => {
  try {
    const lat = req.query.lat as string;
    const lng = req.query.lng as string;
    const zoom = req.query.zoom || "20";

    if (!lat || !lng) {
      res.status(400).json({ error: "lat and lng required" });
      return;
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      res.status(500).end();
      return;
    }

    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=640x640&maptype=satellite&scale=2&key=${apiKey}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });

    if (!response.ok) {
      res.status(response.status).end();
      return;
    }

    res.setHeader("Content-Type", response.headers.get("content-type") || "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch {
    res.status(500).end();
  }
});

// GET /api/images/stored/:analysisId - List stored images for an analysis
router.get("/stored/:analysisId", async (req, res) => {
  try {
    const images = await getStoredImages(req.params.analysisId, db);
    res.json(images);
  } catch {
    res.status(500).json({ error: "Failed to fetch images" });
  }
});

// GET /api/images/stored/file/:imageId - Serve a stored image
router.get("/stored/file/:imageId", async (req, res) => {
  try {
    const img = await getStoredImage(req.params.imageId, db);
    if (!img) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", img.mimeType);
    res.setHeader("Cache-Control", "public, max-age=604800"); // 7 days
    res.send(img.data);
  } catch {
    res.status(500).end();
  }
});

export default router;
