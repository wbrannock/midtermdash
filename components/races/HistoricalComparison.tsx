import type { Baselines, ContestBaseline, RaceResult } from "@/lib/schema";
import { aggregateLocalities, classifyLocality, normalizeLocality, swingPoints, type Comparability } from "@/lib/historical";
import { VA_SPLIT_LOCALITIES } from "@/lib/registry";
import { marginLabel, num, pct, pts } from "@/lib/format";
import { Details } from "@/components/common/Section";

interface CompRow {
  key: string;
  label: string;
  note: string;
  dem: number;
  rep: number;
  total: number;
  marginDR: number | null;
  turnout: number | null;
  registered: number | null;
  complete: boolean;
  localities: number;
}

function rowFromContest(c: ContestBaseline): CompRow {
  const d = c.candidates.filter((x) => x.party === "D").reduce((a, x) => a + x.votes, 0);
  const r = c.candidates.filter((x) => x.party === "R").reduce((a, x) => a + x.votes, 0);
  return {
    key: `${c.year}-full`,
    label: `${c.year} final`,
    note: c.map === "2021-sms" ? "same district lines as 2026" : "district as drawn under the 2016 court-ordered map; not the same geography",
    dem: d,
    rep: r,
    total: c.totalVotes,
    marginDR: c.marginDR,
    turnout: c.turnout.rate,
    registered: c.turnout.registered,
    complete: true,
    localities: c.localities.length,
  };
}

export function HistoricalComparison({ live, baselines }: { live: RaceResult; baselines: Baselines }) {
  const raceId = live.id as "va-05" | "va-09";
  const contests = baselines.contests.filter((c) => c.race === raceId).sort((a, b) => b.year - a.year);
  const c2024 = contests.find((c) => c.year === 2024);
  const c2018 = contests.find((c) => c.year === 2018);
  const comparable = baselines.comparableGeography[`${raceId}:2018`];
  if (!c2024 || !c2018 || !comparable) return null;

  const liveD = live.candidates.filter((c) => c.party === "D").reduce((a, c) => a + c.votes, 0);
  const liveR = live.candidates.filter((c) => c.party === "R").reduce((a, c) => a + c.votes, 0);
  const liveRow: CompRow = {
    key: "2026",
    label: live.reporting.complete ? "2026 (complete)" : "2026 so far",
    note: live.reporting.complete ? "all localities fully reported" : `partial: ${live.reporting.fully ?? 0} of ${live.reporting.unitsTotal} localities fully reported`,
    dem: liveD,
    rep: liveR,
    total: live.totalVotes,
    marginDR: live.marginDR,
    turnout: live.turnout.rate,
    registered: live.turnout.registered,
    complete: live.reporting.complete,
    localities: live.localities.length,
  };

  // Comparable-geography aggregates (2018 lines ≠ 2026 lines): same locality set on both sides,
  // and on the live side only localities that are fully reported count toward "complete".
  const compSet = comparable.localities;
  const live2018Geo = aggregateLocalities(live.localities, compSet);
  const base2018Geo = aggregateLocalities(c2018.localities, compSet);
  const liveCompComplete = live.localities.filter((l) => compSet.map(normalizeLocality).includes(normalizeLocality(l.name))).every((l) => l.complete) && live2018Geo.localities.length === compSet.length;

  const rows: CompRow[] = [liveRow, rowFromContest(c2024), rowFromContest(c2018)];
  const geoRows: CompRow[] = [
    { key: "2026-geo", label: "2026 so far, comparable localities", note: `${compSet.length} localities wholly inside the district under both maps`, dem: live2018Geo.dem, rep: live2018Geo.rep, total: live2018Geo.total, marginDR: live2018Geo.marginDR, turnout: null, registered: null, complete: liveCompComplete, localities: live2018Geo.localities.length },
    { key: "2018-geo", label: "2018 final, comparable localities", note: "same locality set", dem: base2018Geo.dem, rep: base2018Geo.rep, total: base2018Geo.total, marginDR: base2018Geo.marginDR, turnout: null, registered: null, complete: true, localities: base2018Geo.localities.length },
  ];

  const swing2024 = swingPoints(live.marginDR, c2024.marginDR, live.reporting.complete);
  const swing2018Geo = swingPoints(live2018Geo.marginDR, base2018Geo.marginDR, liveCompComplete);


  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-medium">Full-district comparison</h4>
          <span className="text-xs text-fg-3">
            {swing2024 != null ? (
              <span className="num">Swing vs 2024: {pts(swing2024)} pt toward {swing2024 > 0 ? "D" : "R"}</span>
            ) : (
              <span>Swing vs 2024 withheld until every locality is fully reported; partial returns are not a swing estimate.</span>
            )}
          </span>
        </div>
        <CompTable data={rows} />
        <p className="mt-2 text-xs text-fg-3">
          2024 used the same 2021 district lines as 2026, so its full-district figures are directly comparable once returns are complete. 2018 used the 2016 court-ordered map (different localities), so its full-district row is context only. Turnout is contest votes ÷ registered voters on Nov 1 of that year.
        </p>
      </div>
      <div>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-medium">2018 on comparable geography</h4>
          <span className="text-xs text-fg-3">
            {swing2018Geo != null ? (
              <span className="num">Swing vs 2018 (same localities): {pts(swing2018Geo)} pt toward {swing2018Geo > 0 ? "D" : "R"}</span>
            ) : (
              <span>Swing withheld until the comparable localities are fully reported.</span>
            )}
          </span>
        </div>
        <CompTable data={geoRows} />
        <p className="mt-2 text-xs text-fg-3">{comparable.note}</p>
      </div>
      <Details summary={`Locality detail (${live.localities.length} localities)`}>
        <LocalityTable live={live} c2024={c2024} c2018={c2018} comparable={compSet} />
      </Details>
    </div>
  );
}

function CompTable({ data }: { data: CompRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="data">
        <thead>
          <tr>
            <th>Result</th>
            <th className="r">D share</th>
            <th className="r">R share</th>
            <th className="r">D−R margin</th>
            <th className="r">Votes</th>
            <th className="r">Turnout</th>
            <th className="r">Localities</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.key}>
              <td>
                <div className={r.complete ? "" : "text-fg-2"}>{r.label}</div>
                <div className="text-[11px] text-fg-3">{r.note}</div>
              </td>
              <td className="r">{pct(r.total ? r.dem / r.total : null)}</td>
              <td className="r">{pct(r.total ? r.rep / r.total : null)}</td>
              <td className="r font-medium text-fg">{marginLabel(r.marginDR)}</td>
              <td className="r">{num(r.total)}</td>
              <td className="r" title={r.registered ? `${num(r.registered)} registered` : ""}>
                {pct(r.turnout)}
              </td>
              <td className="r">{r.localities}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TAG_LABEL: Record<Comparability, string> = { "same-map": "same lines", comparable: "comparable", moved: "moved", split: "split", "not-reported": "–" };

export function LocalityTable({ live, c2024, c2018, comparable }: { live: RaceResult; c2024: ContestBaseline; c2018: ContestBaseline; comparable: string[] }) {
  const compSet = new Set(comparable.map(normalizeLocality));
  const splitNow = new Set(VA_SPLIT_LOCALITIES["2021-sms"][live.id as "va-05" | "va-09"].map(normalizeLocality));
  const find = (c: ContestBaseline, name: string) => c.localities.find((l) => normalizeLocality(l.name) === normalizeLocality(name));
  const m = (dem: number, rep: number, total: number) => (total > 0 ? ((dem - rep) / total) * 100 : null);
  return (
    <div className="overflow-x-auto">
      <table className="data">
        <thead>
          <tr>
            <th>Locality</th>
            <th className="r">Precincts</th>
            <th className="r">2026 D</th>
            <th className="r">2026 R</th>
            <th className="r">2026 margin</th>
            <th className="r">2024 margin</th>
            <th className="r">Shift vs 2024</th>
            <th className="r">2018 margin</th>
            <th>vs 2018</th>
          </tr>
        </thead>
        <tbody>
          {live.localities.map((l) => {
            const d = l.candidates.filter((c) => c.party === "D").reduce((a, c) => a + c.votes, 0);
            const r = l.candidates.filter((c) => c.party === "R").reduce((a, c) => a + c.votes, 0);
            const b24 = find(c2024, l.name);
            const b18 = find(c2018, l.name);
            const m26 = m(d, r, l.total);
            const m24 = b24 ? m(b24.candidates.filter((c) => c.party === "D").reduce((a, c) => a + c.votes, 0), b24.candidates.filter((c) => c.party === "R").reduce((a, c) => a + c.votes, 0), b24.total) : null;
            const m18 = b18 ? m(b18.candidates.filter((c) => c.party === "D").reduce((a, c) => a + c.votes, 0), b18.candidates.filter((c) => c.party === "R").reduce((a, c) => a + c.votes, 0), b18.total) : null;
            const tag24 = classifyLocality(l.name, c2024, null, splitNow);
            const tag18 = classifyLocality(l.name, c2018, compSet, splitNow);
            const shift = l.complete && m26 != null && m24 != null && tag24 === "same-map" ? m26 - m24 : null;
            return (
              <tr key={l.name} className={l.complete ? "" : "text-fg-2"}>
                <td>
                  {l.name}
                  {tag24 === "split" ? <span className="ml-1 text-[11px] text-fg-3">split</span> : null}
                </td>
                <td className="r">
                  {l.precinctsReporting ?? "–"}/{l.precinctsTotal ?? "–"}
                  {l.complete ? <span className="ml-1 text-good">✓</span> : null}
                </td>
                <td className="r">{num(d)}</td>
                <td className="r">{num(r)}</td>
                <td className="r">{marginLabel(m26)}</td>
                <td className="r">{marginLabel(m24)}</td>
                <td className="r" title={!l.complete ? "Shown only when the locality is fully reported" : tag24 === "split" ? "Locality is split between districts; totals are not comparable" : ""}>
                  {shift == null ? "–" : `${pts(shift)} pt`}
                </td>
                <td className="r">{marginLabel(m18)}</td>
                <td className="text-[11px] text-fg-3" title={tag18 === "moved" ? "Not in the district in 2018" : tag18 === "split" ? "Split between districts in 2018 or 2026" : ""}>
                  {TAG_LABEL[tag18]}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-fg-3">Shift vs 2024 appears only for fully reported, unsplit localities (same lines in both years). 2018 margins are for the locality&apos;s whole vote as reported in that year, so only localities tagged comparable are like-for-like.</p>
    </div>
  );
}
