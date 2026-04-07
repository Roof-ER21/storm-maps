/**
 * Hail Yes! - AI Property Analysis Types
 *
 * Client-side type definitions for the AI property analysis engine.
 * These mirror the server schema at server/ai/schema.ts and are used
 * across all AI-related components and services.
 */

// ============================================================
// Discriminated Union / Literal Types
// ============================================================

export type RoofType =
  | 'three_tab_shingle'
  | 'architectural_shingle'
  | 'designer_shingle'
  | 'wood_shake'
  | 'synthetic_shake'
  | 'metal_standing_seam'
  | 'metal_ribbed'
  | 'tile_clay'
  | 'tile_concrete'
  | 'slate'
  | 'flat_membrane'
  | 'unknown';

export type SidingType =
  | 'aluminum'
  | 'vinyl'
  | 'wood'
  | 'fiber_cement'
  | 'brick'
  | 'stone'
  | 'stucco'
  | 'composite'
  | 'unknown';

export type ConditionRating =
  | 'excellent'
  | 'good'
  | 'fair'
  | 'poor'
  | 'critical'
  | 'unknown';

export type AnalysisStatus =
  | 'pending'
  | 'geocoding'
  | 'fetching_images'
  | 'analyzing'
  | 'completed'
  | 'failed';

export type AnalysisMode = 'retail' | 'insurance' | 'solar';

export type LeadStatus =
  | 'new'
  | 'knocked'
  | 'not_home'
  | 'callback'
  | 'pitched'
  | 'sold'
  | 'skip';

// ============================================================
// Sub-Object Types
// ============================================================

export interface DamageIndicator {
  type: string;
  severity: 'minor' | 'moderate' | 'severe';
  location: string;
}

// ============================================================
// Core Entity Types
// ============================================================

export interface PropertyAnalysis {
  id: string;
  inputAddress: string;
  normalizedAddress: string | null;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
  streetViewUrl: string | null;
  satelliteUrl: string | null;
  streetViewAvailable: boolean;
  streetViewDate: string | null;

  // Roof analysis
  roofType: RoofType | null;
  roofCondition: ConditionRating | null;
  roofAgeEstimate: number | null;
  roofConfidence: number | null;
  roofColor: string | null;

  // Siding analysis
  isAluminumSiding: boolean;
  sidingType: SidingType | null;
  sidingCondition: ConditionRating | null;
  sidingConfidence: number | null;

  // Detailed findings
  roofFeatures: string[];
  sidingFeatures: string[];
  reasoning: string | null;
  damageIndicators: DamageIndicator[];

  // Scoring / priority
  prospectScore: number | null;
  isHighPriority: boolean;

  // AI metadata
  aiRawResponse: Record<string, unknown> | null;
  aiModelUsed: string | null;

  // CRM fields
  starred: boolean;
  leadStatus: LeadStatus;
  repNotes: string | null;
  lastContactedAt: string | null;

  // Job lifecycle
  status: AnalysisStatus;
  errorMessage: string | null;
  batchJobId: string | null;
  createdAt: string;
  analyzedAt: string | null;
}

export interface PropertyImage {
  id: string;
  analysisId: string;
  imageType: string;
  imageData: string;
  mimeType: string;
  captureDate: string | null;
}

export interface BatchJob {
  id: string;
  fileName: string | null;
  totalAddresses: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  summaryStats: Record<string, unknown> | null;
  createdAt: string;
}

// ============================================================
// Dashboard / Aggregate Types
// ============================================================

export interface AiDashboardStats {
  total: number;
  completed: number;
  failed: number;
  highPriority: number;
  aluminumSiding: number;
  today: number;
  roofTypeBreakdown: Record<string, number>;
  leadPipeline: Record<string, number>;
  topLeads: PropertyAnalysis[];
  storage: { imageCount: number; sizeMb: number };
  recentActivity: Array<{ action: string; details: unknown; createdAt: string }>;
}
