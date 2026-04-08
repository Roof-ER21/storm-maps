import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { getAiLeads } from '../services/aiApi';
import type {
  CanvassOutcome,
  CanvassRouteArchive,
  CanvassRouteStop,
  CanvassStopStatus,
  LeadStage,
  PinnedProperty,
  PropertySearchSummary,
} from '../types/storm';

// Lazy-load the heavy sub-sections
import PinnedPropertiesPage from './PinnedPropertiesPage';
import CanvassPage from './CanvassPage';
import LeadsPage from './LeadsPage';
const AiLeadsPage = lazy(() => import('./AiLeadsPage'));

type PipelineTab = 'targets' | 'route' | 'leads' | 'ai-prospects';

interface PipelinePageProps {
  searchSummary: PropertySearchSummary | null;

  // Pinned (Targets)
  pinnedProperties: PinnedProperty[];
  routeCountsByPropertyId: Record<string, { active: number; booked: number; followUp: number; new: number; contacted: number; inspectionSet: number; won: number; lost: number }>;
  onOpenProperty: (property: PinnedProperty) => void;
  onRemoveProperty: (propertyId: string) => void;

  // Canvass (Route)
  routeStops: CanvassRouteStop[];
  routeArchives: CanvassRouteArchive[];
  onFocusStop: (stop: CanvassRouteStop) => void;
  onBuildKnockRoute: () => void;
  onOpenNavigation: () => void;
  onExportSummary: () => void;
  onExportCsv: () => void;
  onClearRoute: () => void;
  onUpdateStopStatus: (stopId: string, status: CanvassStopStatus) => void;
  onUpdateStopOutcome: (stopId: string, outcome: CanvassOutcome) => void;
  onUpdateStopNotes: (stopId: string, notes: string) => void;
  onUpdateStopHomeowner: (stopId: string, field: 'homeownerName' | 'homeownerPhone' | 'homeownerEmail', value: string) => void;
  onRemoveStop: (stopId: string) => void;
  onRestoreArchive: (archiveId: string) => void;
  onRemoveArchive: (archiveId: string) => void;

  // Leads
  onUpdateLeadStage: (stopId: string, leadStage: LeadStage) => void;
  onUpdateLeadReminder: (stopId: string, reminderAt: string) => void;
  onUpdateLeadAssignedRep: (stopId: string, rep: string) => void;
  onUpdateLeadDealValue: (stopId: string, value: number | null) => void;
  onShareLeadReport: (stop: CanvassRouteStop) => void;
  onUpdateLeadChecklist: (stopId: string, key: string, done: boolean) => void;
  onLookupPropertyOwner: (stopId: string) => void;

  onOpenMap: () => void;
  onOpenAiAnalysis?: (address: string) => void;
}

const TABS: Array<{ id: PipelineTab; label: string; desc: string }> = [
  { id: 'targets', label: 'Targets', desc: 'Pinned properties' },
  { id: 'route', label: 'Route', desc: 'Canvass stops' },
  { id: 'leads', label: 'Leads', desc: 'Sales pipeline' },
  { id: 'ai-prospects', label: 'AI Prospects', desc: 'AI-analyzed leads' },
];

export default function PipelinePage(props: PipelinePageProps) {
  const [activeTab, setActiveTab] = useState<PipelineTab>('leads');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [aiProspectCount, setAiProspectCount] = useState(0);

  useEffect(() => {
    getAiLeads({ limit: 1 })
      .then((result) => setAiProspectCount(result.pagination.total))
      .catch(() => { /* non-critical — leave count at 0 */ });
  }, []);

  const activeLeadCount = props.routeStops.filter((s) =>
    s.outcome === 'interested' || s.outcome === 'follow_up' || s.outcome === 'inspection_booked',
  ).length;
  const routeCount = props.routeStops.filter((s) => s.status !== 'completed').length;

  return (
    <section ref={scrollRef} className="flex-1 overflow-y-auto bg-[#faf9f7]">
      {/* Sticky tab nav */}
      <div className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 backdrop-blur px-4 py-3 lg:px-6">
        <div className="mx-auto flex max-w-7xl items-center gap-2">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const count = tab.id === 'targets' ? props.pinnedProperties.length
              : tab.id === 'route' ? routeCount
              : tab.id === 'leads' ? activeLeadCount
              : aiProspectCount;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
                  isActive
                    ? 'bg-[linear-gradient(135deg,#f97316,#7c3aed)] text-white shadow-[0_8px_24px_rgba(124,58,237,0.25)]'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-900'
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span className={`flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                    isActive ? 'bg-white/20 text-white' : 'bg-stone-200 text-stone-500'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="px-0">
        {activeTab === 'targets' && (
          <PinnedPropertiesPage
            pinnedProperties={props.pinnedProperties}
            routeCountsByPropertyId={props.routeCountsByPropertyId}
            onOpenProperty={props.onOpenProperty}
            onRemoveProperty={props.onRemoveProperty}
            onOpenMap={props.onOpenMap}
          />
        )}

        {activeTab === 'route' && (
          <CanvassPage
            searchSummary={props.searchSummary}
            routeStops={props.routeStops}
            routeArchives={props.routeArchives}
            onOpenMap={props.onOpenMap}
            onFocusStop={props.onFocusStop}
            onBuildKnockRoute={props.onBuildKnockRoute}
            onOpenNavigation={props.onOpenNavigation}
            onExportSummary={props.onExportSummary}
            onExportCsv={props.onExportCsv}
            onClearRoute={props.onClearRoute}
            onUpdateStopStatus={props.onUpdateStopStatus}
            onUpdateStopOutcome={props.onUpdateStopOutcome}
            onUpdateStopNotes={props.onUpdateStopNotes}
            onUpdateStopHomeowner={props.onUpdateStopHomeowner}
            onRemoveStop={props.onRemoveStop}
            onRestoreArchive={props.onRestoreArchive}
            onRemoveArchive={props.onRemoveArchive}
          />
        )}

        {activeTab === 'leads' && (
          <LeadsPage
            searchSummary={props.searchSummary}
            routeStops={props.routeStops}
            routeArchives={props.routeArchives}
            onOpenMap={props.onOpenMap}
            onOpenCanvass={() => setActiveTab('route')}
            onFocusLead={(stop) => { props.onFocusStop(stop); props.onOpenMap(); }}
            onUpdateLeadStatus={props.onUpdateStopStatus}
            onUpdateLeadOutcome={props.onUpdateStopOutcome}
            onUpdateLeadStage={props.onUpdateLeadStage}
            onUpdateLeadNotes={props.onUpdateStopNotes}
            onUpdateLeadReminder={props.onUpdateLeadReminder}
            onUpdateLeadAssignedRep={props.onUpdateLeadAssignedRep}
            onUpdateLeadDealValue={props.onUpdateLeadDealValue}
            onShareLeadReport={props.onShareLeadReport}
            onUpdateLeadChecklist={props.onUpdateLeadChecklist}
            onLookupPropertyOwner={props.onLookupPropertyOwner}
            onUpdateLeadHomeowner={props.onUpdateStopHomeowner}
            onRestoreArchive={props.onRestoreArchive}
          />
        )}

        {activeTab === 'ai-prospects' && (
          <Suspense fallback={
            <div className="flex flex-1 items-center justify-center py-24 text-stone-400 text-sm">
              Loading AI Prospects...
            </div>
          }>
            <AiLeadsPage
              onViewAnalysis={(address) => {
                if (props.onOpenAiAnalysis) props.onOpenAiAnalysis(address);
              }}
            />
          </Suspense>
        )}
      </div>
    </section>
  );
}
