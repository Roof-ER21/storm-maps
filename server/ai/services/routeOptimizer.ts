/**
 * Canvass Route Optimizer
 * Given a list of property coordinates, returns them in optimal walking/driving order
 * using nearest-neighbor heuristic (good enough for field canvassing).
 */

export interface RoutePoint {
  id: string;
  lat: number;
  lng: number;
  address: string;
  score: number;
}

export interface OptimizedRoute {
  points: RoutePoint[];
  totalDistanceMiles: number;
  estimatedWalkMinutes: number;
  estimatedDriveMinutes: number;
}

/**
 * Optimize route using nearest-neighbor algorithm.
 * Starts from the highest-scoring property (best lead first)
 * then visits each nearest unvisited property.
 */
export function optimizeRoute(points: RoutePoint[]): OptimizedRoute {
  if (points.length <= 1) {
    return {
      points,
      totalDistanceMiles: 0,
      estimatedWalkMinutes: 0,
      estimatedDriveMinutes: 0,
    };
  }

  // Start with highest-scoring property
  const sorted = [...points].sort((a, b) => b.score - a.score);
  const result: RoutePoint[] = [sorted[0]];
  const remaining = new Set(sorted.slice(1).map((p) => p.id));

  while (remaining.size > 0) {
    const current = result[result.length - 1];
    let nearest: RoutePoint | null = null;
    let nearestDist = Infinity;

    for (const p of points) {
      if (!remaining.has(p.id)) continue;
      const d = haversine(current.lat, current.lng, p.lat, p.lng);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = p;
      }
    }

    if (nearest) {
      result.push(nearest);
      remaining.delete(nearest.id);
    }
  }

  // Calculate total distance
  let totalMiles = 0;
  for (let i = 1; i < result.length; i++) {
    totalMiles += haversine(
      result[i - 1].lat,
      result[i - 1].lng,
      result[i].lat,
      result[i].lng
    );
  }

  return {
    points: result,
    totalDistanceMiles: Math.round(totalMiles * 100) / 100,
    estimatedWalkMinutes: Math.round(totalMiles * 20), // ~3 mph walking
    estimatedDriveMinutes: Math.round(totalMiles * 3), // ~20 mph neighborhood driving
  };
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
