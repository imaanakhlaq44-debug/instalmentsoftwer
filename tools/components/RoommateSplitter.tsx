'use client';

import { useMemo, useState } from 'react';
import { CarFront, Check, DoorOpen, Plus, Sparkles, Bath, Mountain } from 'lucide-react';
import type { CurrencyCode } from '@/lib/site-data';
import { formatMoney } from '@/lib/calculations';
import { Card, SectionTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

type Room = { name: string; sqft: number; bathroom: boolean; view: boolean; parking: number };
const seedRooms: Room[] = [
  { name: 'The Corner Room', sqft: 180, bathroom: true, view: true, parking: 0 },
  { name: 'Room Two', sqft: 150, bathroom: false, view: true, parking: 0 },
  { name: 'Room Three', sqft: 125, bathroom: false, view: false, parking: 0 },
];

export default function RoommateSplitter({ currency }: { currency: CurrencyCode }) {
  const [rent, setRent] = useState(3600);
  const [rooms, setRooms] = useState<Room[]>(seedRooms);
  const [copied, setCopied] = useState(false);

  function changeBedroomCount(value: number) {
    const count = Math.max(1, Math.min(8, Math.floor(value || 1)));
    setRooms((previous) => Array.from({ length: count }, (_, index) => previous[index] ?? { name: `Room ${index + 1}`, sqft: 140, bathroom: false, view: false, parking: 0 }));
  }
  function updateRoom(index: number, patch: Partial<Room>) {
    setRooms((previous) => previous.map((room, roomIndex) => roomIndex === index ? { ...room, ...patch } : room));
  }

  const results = useMemo(() => {
    const parkingRequested = rooms.reduce((sum, room) => sum + Math.max(0, room.parking), 0);
    const parkingTotal = Math.min(rent, parkingRequested);
    const remainingRent = Math.max(0, rent - parkingTotal);
    const weights = rooms.map((room) => Math.max(1, room.sqft) * (room.bathroom ? 1.15 : 1) * (room.view ? 1.05 : 1));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    const allocations = rooms.map((room, index) => {
      const parking = parkingRequested > rent && parkingRequested > 0 ? (parkingTotal * room.parking) / parkingRequested : Math.min(room.parking, parkingTotal);
      const share = weights[index] / totalWeight;
      return { amount: remainingRent * share + parking, percent: rent > 0 ? (remainingRent * share + parking) / rent * 100 : 0, parking, weight: share };
    });
    return { allocations, parkingAdjusted: parkingRequested > rent, sum: allocations.reduce((total, item) => total + item.amount, 0) };
  }, [rooms, rent]);

  async function copySplit() {
    const lines = ['RentWise Tools · Roommate rent split', `Total monthly rent: ${formatMoney(rent, currency)}`, ...rooms.map((room, index) => `${room.name}: ${formatMoney(results.allocations[index]?.amount ?? 0, currency)} (${(results.allocations[index]?.percent ?? 0).toFixed(1)}%)`), 'Allocation is a planning estimate; agree final terms together.'];
    try { await navigator.clipboard.writeText(lines.join('\n')); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); }
  }

  return <div className="roommate-layout">
    <Card className="calculator-input-card">
      <SectionTitle eyebrow="FAIR SHARE" title="A split that feels fair" description="Give the better room a little more weight, without leaving the total rent behind." />
      <div className="field-grid two-fields">
        <Input id="apartment-rent" label="Total apartment rent" type="number" inputMode="decimal" min="0" step="50" value={rent} onChange={(event) => setRent(Math.max(0, Number(event.target.value) || 0))} suffix="/ month" />
        <Input id="bedroom-count" label="Bedrooms / roommates" type="number" inputMode="numeric" min="1" max="8" step="1" value={rooms.length} onChange={(event) => changeBedroomCount(Number(event.target.value))} suffix="rooms" />
      </div>
      <div className="room-list-heading"><span>ROOM DETAILS</span><span>Adjust each room's share</span></div>
      <div className="room-editor-list">
        {rooms.map((room, index) => <div className="room-editor" key={index}>
          <div className="room-editor-top"><div className="room-number"><DoorOpen size={15} /> {String(index + 1).padStart(2, '0')}</div><input className="room-name-input" aria-label={`Room ${index + 1} name`} value={room.name} onChange={(event) => updateRoom(index, { name: event.target.value })} /></div>
          <div className="room-config-row">
            <div className="room-area"><label htmlFor={`room-area-${index}`}>Approx. area</label><div className="tiny-input"><input id={`room-area-${index}`} type="number" min="1" step="5" inputMode="numeric" value={room.sqft} onChange={(event) => updateRoom(index, { sqft: Math.max(1, Number(event.target.value) || 1) })} /><span>sq ft</span></div></div>
            <label className={`feature-toggle ${room.bathroom ? 'feature-on' : ''}`}><input type="checkbox" checked={room.bathroom} onChange={(event) => updateRoom(index, { bathroom: event.target.checked })} /><span className="toggle-icon"><Bath size={15} /></span><span>Private bath <small>+15%</small></span></label>
            <label className={`feature-toggle ${room.view ? 'feature-on' : ''}`}><input type="checkbox" checked={room.view} onChange={(event) => updateRoom(index, { view: event.target.checked })} /><span className="toggle-icon"><Mountain size={15} /></span><span>Better view <small>+5%</small></span></label>
          </div>
          <div className="parking-row"><CarFront size={15} aria-hidden="true" /><label htmlFor={`room-parking-${index}`}>Reserved parking premium</label><div className="parking-input"><span>{currency === 'GBP' ? '£' : '$'}</span><input id={`room-parking-${index}`} type="number" min="0" step="25" inputMode="decimal" value={room.parking} onChange={(event) => updateRoom(index, { parking: Math.max(0, Number(event.target.value) || 0) })} /><small>/ month</small></div></div>
        </div>)}
      </div>
      <p className="fine-print"><Sparkles size={14} aria-hidden="true" /> Base shares scale with room size; selected features add a transparent weighting.</p>
      {results.parkingAdjusted && <p className="inline-warning" role="status">Parking premiums exceeded the apartment rent, so they were scaled proportionally.</p>}
    </Card>

    <Card className="split-results" aria-live="polite">
      <div className="split-summary-head"><div><p className="eyebrow">THE MONTHLY SPLIT</p><h3>Everyone knows their share.</h3></div><div className="split-total"><span>Total rent</span><strong>{formatMoney(rent, currency)}</strong></div></div>
      <div className="split-bars" role="list" aria-label="Rent share for each room">
        {rooms.map((room, index) => {
          const result = results.allocations[index];
          const colors = ['#cff47b', '#72d8b8', '#a6a0ff', '#ffbb85', '#f291a3', '#83c7f5', '#d7a7f5', '#b5c3cd'];
          return <div key={index} className="split-person" role="listitem">
            <div className="split-person-top"><div className="person-id"><span className="person-dot" style={{ background: colors[index % colors.length] }} /><span>{room.name || `Room ${index + 1}`}</span></div><strong>{formatMoney(result?.amount ?? 0, currency)}</strong></div>
            <div className="share-track"><div className="share-fill" style={{ width: `${Math.max(0, Math.min(100, result?.percent ?? 0))}%`, background: colors[index % colors.length] }} /></div>
            <div className="share-meta"><span>{(result?.percent ?? 0).toFixed(1)}% of total</span><span>{Math.round(result?.percent ?? 0)}% share</span></div>
          </div>;
        })}
      </div>
      <div className="split-foot"><span>Allocated total</span><strong>{formatMoney(results.sum, currency)} <Check size={15} /></strong></div>
      <button type="button" className="button button-dark receipt-copy" onClick={copySplit} aria-label="Copy roommate rent split to clipboard">{copied ? <Check size={16} /> : <Plus size={16} />}{copied ? 'Split copied' : 'Copy roommate split'}</button>
      <p className="receipt-footnote">A conversation starter, not a legal agreement.</p>
    </Card>
  </div>;
}
