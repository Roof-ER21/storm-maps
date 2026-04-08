import { useCallback, useState } from 'react';

export interface ImportedHomeowner {
  address: string;
  name: string;
  phone: string;
  email: string;
  raw: Record<string, string>;
}

interface HomeownerImportProps {
  onImport: (homeowners: ImportedHomeowner[]) => void;
  onClose: () => void;
}

interface ColumnMapping {
  address: string;
  name: string;
  phone: string;
  email: string;
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (values[i] || '').trim(); });
    return row;
  });

  return { headers, rows };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function guessMapping(headers: string[]): ColumnMapping {
  const lower = headers.map((h) => h.toLowerCase());

  const find = (keywords: string[]) =>
    headers[lower.findIndex((h) => keywords.some((k) => h.includes(k)))] || '';

  return {
    address: find(['address', 'street', 'location', 'property']),
    name: find(['name', 'owner', 'homeowner', 'contact', 'first']),
    phone: find(['phone', 'tel', 'mobile', 'cell']),
    email: find(['email', 'mail', 'e-mail']),
  };
}

export default function HomeownerImport({ onImport, onClose }: HomeownerImportProps) {
  const [step, setStep] = useState<'upload' | 'map' | 'preview'>('upload');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({ address: '', name: '', phone: '', email: '' });
  const [fileName, setFileName] = useState('');

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const { headers: h, rows: r } = parseCSV(reader.result as string);
      if (h.length === 0) { window.alert('Could not parse CSV. Check the file format.'); return; }
      setHeaders(h);
      setRows(r);
      setMapping(guessMapping(h));
      setStep('map');
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) handleFile(file);
  }, [handleFile]);

  const mapped = rows.map((row) => ({
    address: row[mapping.address] || '',
    name: row[mapping.name] || '',
    phone: row[mapping.phone] || '',
    email: row[mapping.email] || '',
    raw: row,
  })).filter((r) => r.address.trim());

  const handleConfirm = () => {
    onImport(mapped);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 backdrop-blur-sm py-4" onClick={onClose}>
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl border border-stone-200 bg-white shadow-xl p-5 mx-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-300">Import Homeowners</p>
            <p className="mt-1 text-sm text-stone-500">
              {step === 'upload' ? 'Upload a CSV file with property data' :
               step === 'map' ? 'Map columns to homeowner fields' :
               `Preview ${mapped.length} homeowners to import`}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close import dialog" className="flex h-8 w-8 items-center justify-center text-stone-500 hover:text-stone-900 text-xl">&times;</button>
        </div>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div
            className="rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50 p-12 text-center hover:border-orange-400 transition-colors"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <p className="text-lg font-semibold text-stone-900">Drop CSV here</p>
            <p className="mt-2 text-sm text-stone-500">or click to browse</p>
            <label className="mt-4 inline-block cursor-pointer rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-5 py-3 text-sm font-semibold text-white">
              Choose File
              <input type="file" accept=".csv" className="hidden" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }} />
            </label>
            <p className="mt-4 text-xs text-stone-400">
              Works with exports from Cole Information, ListSource, ATTOM, HailTrace, PropertyRadar, or any CSV with address + contact columns.
            </p>
          </div>
        )}

        {/* Step 2: Column Mapping */}
        {step === 'map' && (
          <div>
            <p className="text-sm text-stone-500 mb-4">
              File: <span className="text-stone-900 font-semibold">{fileName}</span> — {rows.length} rows, {headers.length} columns
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              {(['address', 'name', 'phone', 'email'] as const).map((field) => (
                <div key={field}>
                  <label htmlFor={`col-map-${field}`} className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">
                    {field === 'address' ? 'Property Address *' : field === 'name' ? 'Owner Name' : field === 'phone' ? 'Phone Number' : 'Email Address'}
                  </label>
                  <select
                    id={`col-map-${field}`}
                    value={mapping[field]}
                    onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 focus:border-orange-400/40 focus:outline-none"
                  >
                    <option value="">— Skip —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                  {/* Preview first value */}
                  {mapping[field] && rows[0] && (
                    <p className="mt-1 text-[10px] text-stone-400 truncate">
                      e.g. "{rows[0][mapping[field]]}"
                    </p>
                  )}
                </div>
              ))}
            </div>

            {!mapping.address && (
              <p className="mt-4 text-xs text-red-400">Address column is required to create leads.</p>
            )}

            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setStep('upload')} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm font-semibold text-stone-900 hover:bg-stone-100">
                Back
              </button>
              <button
                type="button"
                onClick={() => setStep('preview')}
                disabled={!mapping.address}
                className="rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                Preview {mapped.length} Homeowners
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {step === 'preview' && (
          <div>
            <div className="rounded-2xl border border-stone-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50/60">
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-stone-400">Address</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-stone-400">Name</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-stone-400">Phone</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-stone-400">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {mapped.slice(0, 10).map((row, i) => (
                    <tr key={i} className="border-b border-stone-200/50">
                      <td className="px-3 py-2 text-stone-900 truncate max-w-[200px]">{row.address}</td>
                      <td className="px-3 py-2 text-stone-600 truncate">{row.name || '—'}</td>
                      <td className="px-3 py-2 text-stone-600">{row.phone || '—'}</td>
                      <td className="px-3 py-2 text-stone-600 truncate">{row.email || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {mapped.length > 10 && (
              <p className="mt-2 text-xs text-stone-400">Showing 10 of {mapped.length} rows</p>
            )}

            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setStep('map')} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm font-semibold text-stone-900 hover:bg-stone-100">
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-5 py-2.5 text-sm font-semibold text-white"
              >
                Import {mapped.length} Homeowners as Leads
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
