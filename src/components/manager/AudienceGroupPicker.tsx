"use client";

import { AUDIENCE_GROUP_KEYS, type AudienceGroupKey } from "@/lib/domain/audienceGroups";
import { personnelTypeGroupLabel, regularRoleGroupLabel } from "@/lib/presentation/roster";

interface AudienceGroupOption {
  key: AudienceGroupKey;
  label: string;
}

/** Service-type groups first (קבע/סדיר/מילואים), then role groups (אחמ״שים/טכנאים) -- reuses the SAME Hebrew labels the roster listing already shows (`lib/presentation/roster.ts`), never a second label table. */
const SERVICE_TYPE_OPTIONS: AudienceGroupOption[] = ["permanent", "regular", "reserve"].map((key) => ({
  key: key as AudienceGroupKey,
  label: personnelTypeGroupLabel(key as "permanent" | "regular" | "reserve"),
}));
const ROLE_OPTIONS: AudienceGroupOption[] = ["supervisor", "technician"].map((key) => ({
  key: key as AudienceGroupKey,
  label: regularRoleGroupLabel(key as "supervisor" | "technician"),
}));

interface AudienceGroupPickerProps {
  selectedKeys: readonly AudienceGroupKey[];
  onToggle: (key: AudienceGroupKey) => void;
}

function GroupChip({ option, checked, onToggle }: { option: AudienceGroupOption; checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
        checked ? "bg-primary text-primary-foreground ring-primary" : "bg-overlay-soft text-foreground ring-border hover:bg-overlay-strong"
      }`}
    >
      {option.label}
    </button>
  );
}

/**
 * The shared "לפי קבוצות" multi-select every audience-selecting composer
 * reuses -- reliable, canonical groups only (`lib/domain/audienceGroups.ts`'s
 * `AudienceGroupKey`, all ${AUDIENCE_GROUP_KEYS.length} of them), never a
 * free-text or name-based group. Multiple groups may be selected together
 * (union semantics -- a person matching ANY selected group is included);
 * membership is always resolved fresh against the current roster by the
 * shared `lib/domain/audienceSelection.ts` resolver, never frozen here.
 */
export function AudienceGroupPicker({ selectedKeys, onToggle }: AudienceGroupPickerProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-muted-2">לפי סוג שירות</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="קבוצות לפי סוג שירות">
          {SERVICE_TYPE_OPTIONS.map((option) => (
            <GroupChip key={option.key} option={option} checked={selectedKeys.includes(option.key)} onToggle={() => onToggle(option.key)} />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-muted-2">לפי תפקיד</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="קבוצות לפי תפקיד">
          {ROLE_OPTIONS.map((option) => (
            <GroupChip key={option.key} option={option} checked={selectedKeys.includes(option.key)} onToggle={() => onToggle(option.key)} />
          ))}
        </div>
      </div>
    </div>
  );
}

export { AUDIENCE_GROUP_KEYS };
