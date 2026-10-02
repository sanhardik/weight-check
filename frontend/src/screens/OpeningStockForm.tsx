import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput } from "react-native";
import { router } from "expo-router";
import { useAuth, apiFetch } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";
import { BInput } from "@/src/ui/BInput";
import { BButton } from "@/src/ui/BButton";
import { Dropdown } from "@/src/ui/Dropdown";
import { toast } from "@/src/ui/Toast";

type Row = { id: string; thickness_mm: string; width_mm: string; length_mm: string; grade: string; pieces: string };
const newRow = (): Row => ({ id: Math.random().toString(36).slice(2), thickness_mm: "", width_mm: "", length_mm: "", grade: "", pieces: "" });

const DENSITY = 7850;
function rowWeightKg(r: Row): number {
  const t = parseFloat(r.thickness_mm), w = parseFloat(r.width_mm), l = parseFloat(r.length_mm), p = parseFloat(r.pieces);
  if (!t || !w || !l || !p) return 0;
  return (t * w * l * p * DENSITY) / 1e9;
}

/**
 * Bulk opening-stock loader. One auditable INWARD entry (vehicle OPENING-STOCK)
 * carrying every row as a line item. Used by Admin (mobile) and Office (portal).
 */
export function OpeningStockForm({ onDone }: { onDone?: () => void }) {
  const { token } = useAuth();
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<{ thicknesses: string[]; widths: string[]; lengths: string[]; grades: string[] }>({ thicknesses: [], widths: [], lengths: [], grades: [] });
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [pasteText, setPasteText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    const kinds = ["thicknesses", "widths", "lengths", "grades"] as const;
    Promise.all(kinds.map((k) => apiFetch(`/catalog/${k}`, {}, token).catch(() => [])))
      .then((rs) => {
        const val = (arr: any[]) => (arr || []).map((x: any) => String(x.value));
        setCatalog({ thicknesses: val(rs[0]), widths: val(rs[1]), lengths: val(rs[2]), grades: val(rs[3]) });
      });
  }, [token]);

  const validRows = useMemo(
    () => rows.filter((r) => r.thickness_mm && r.width_mm && r.length_mm && r.pieces && parseFloat(r.pieces) > 0),
    [rows]
  );
  const totals = useMemo(() => ({
    lines: validRows.length,
    pieces: validRows.reduce((a, r) => a + parseFloat(r.pieces), 0),
    weight: validRows.reduce((a, r) => a + rowWeightKg(r), 0),
  }), [validRows]);

  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  /** Paste from Excel: one row per line — Thickness, Width, Length, Grade(optional), Pieces (tab or comma separated) */
  const importPaste = () => {
    const lines = pasteText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) { toast("Nothing to import", "warning"); return; }
    const added: Row[] = [];
    const skipped: number[] = [];
    lines.forEach((line, i) => {
      const cells = line.split(/\t|,/).map((c) => c.trim());
      const nums = cells.filter((c) => c !== "");
      if (nums.length < 4) { skipped.push(i + 1); return; }
      // t, w, l, [grade], pieces — grade is optional (non-numeric cell before last)
      const t = nums[0], w = nums[1], l = nums[2];
      let grade = "";
      let pieces = "";
      if (nums.length >= 5) { grade = nums[3]; pieces = nums[4]; }
      else { pieces = nums[3]; }
      if ([t, w, l, pieces].some((v) => isNaN(parseFloat(v)))) { skipped.push(i + 1); return; }
      added.push({ id: Math.random().toString(36).slice(2), thickness_mm: t, width_mm: w, length_mm: l, grade, pieces });
    });
    if (added.length > 0) {
      setRows((p) => {
        const existing = p.filter((r) => r.thickness_mm || r.width_mm || r.length_mm || r.pieces);
        return [...existing, ...added];
      });
      setPasteText("");
      toast(`✓ Imported ${added.length} rows${skipped.length ? ` · skipped ${skipped.length} bad rows (${skipped.join(", ")})` : ""}`, skipped.length ? "warning" : "success");
    } else {
      toast(`No valid rows. Format: Thickness, Width, Length, [Grade], Pieces`, "error");
    }
  };

  const submit = async () => {
    if (validRows.length === 0) { toast("Add at least one complete row", "error"); return; }
    setSaving(true);
    try {
      const res = await apiFetch("/entries/inward", {
        method: "POST",
        body: JSON.stringify({
          vehicle_number: "OPENING-STOCK",
          driver_name: null, driver_phone: null, mukadam_name: null,
          line_items: validRows.map((r) => ({
            thickness_mm: parseFloat(r.thickness_mm),
            width_mm: parseFloat(r.width_mm),
            length_mm: parseFloat(r.length_mm),
            pieces: parseFloat(r.pieces),
            grade: r.grade || null,
          })),
          actual_weight_kg: null,
          slip_photo_path: null,
          remarks: `Opening stock bulk load — ${validRows.length} items`,
          entry_date: new Date(entryDate + "T00:00:00").toISOString(),
        }),
      }, token);
      toast(`✓ Opening stock saved: ${res.entry_number} — ${totals.lines} items, ${totals.pieces} pcs`, "success");
      setRows([newRow()]);
      if (onDone) onDone();
      else router.push("/inventory");
    } catch (e: any) {
      toast(e.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      <View style={s.infoBox}>
        <Text style={s.infoTitle}>How it works</Text>
        <Text style={s.infoTxt}>Fill one row per item (or paste from Excel below), then submit once. Everything lands in Inventory as a single INWARD entry with vehicle OPENING-STOCK — fully auditable and editable later by admin.</Text>
      </View>

      <BInput testID="opening-date" label={`${t("entry_date")} (YYYY-MM-DD)`} value={entryDate} onChangeText={setEntryDate} />

      {rows.map((r, idx) => (
        <View key={r.id} style={s.rowCard} testID={`opening-row-${idx}`}>
          <View style={s.rowHdr}>
            <Text style={s.rowTitle}>ITEM {idx + 1}{rowWeightKg(r) > 0 ? ` · ≈${rowWeightKg(r).toFixed(1)} kg` : ""}</Text>
            {rows.length > 1 ? (
              <Pressable testID={`opening-remove-${idx}`} onPress={() => setRows((p) => p.filter((x) => x.id !== r.id))}>
                <Text style={{ color: colors.error, fontWeight: "900", fontSize: 11, letterSpacing: 1 }}>REMOVE</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={s.rowGrid}>
            <View style={s.cell}>
              <Dropdown testID={`opening-row-${idx}-thickness`} label={`${t("thickness")} (mm)`} value={r.thickness_mm || null} options={catalog.thicknesses} onChange={(v) => setRow(r.id, { thickness_mm: v })} placeholder="SELECT" />
            </View>
            <View style={s.cell}>
              <Dropdown testID={`opening-row-${idx}-width`} label={`${t("width")} (mm)`} value={r.width_mm || null} options={catalog.widths} onChange={(v) => setRow(r.id, { width_mm: v })} placeholder="SELECT" />
            </View>
            <View style={s.cell}>
              <Dropdown testID={`opening-row-${idx}-length`} label={`${t("length")} (mm)`} value={r.length_mm || null} options={catalog.lengths} onChange={(v) => setRow(r.id, { length_mm: v })} placeholder="SELECT" />
            </View>
            <View style={s.cell}>
              <Dropdown testID={`opening-row-${idx}-grade`} label={t("grade")} value={r.grade || null} options={catalog.grades} onChange={(v) => setRow(r.id, { grade: v })} placeholder="OPTIONAL" />
            </View>
            <View style={s.cell}>
              <BInput testID={`opening-row-${idx}-pieces`} label={t("pieces")} value={r.pieces} onChangeText={(v) => setRow(r.id, { pieces: v })} keyboardType="decimal-pad" />
            </View>
          </View>
        </View>
      ))}

      <Pressable testID="opening-add-row" onPress={() => setRows((p) => [...p, newRow()])} style={s.addRow}>
        <Text style={s.addRowTxt}>+ ADD ANOTHER ITEM</Text>
      </Pressable>

      <View style={s.pasteBox}>
        <Text style={s.secTitle}>📋 PASTE FROM EXCEL (optional)</Text>
        <Text style={s.pasteHint}>One row per line: Thickness, Width, Length, Grade (optional), Pieces — tab or comma separated{"\n"}e.g.  8	1250	2500	IS2062	40</Text>
        <TextInput
          testID="opening-paste"
          value={pasteText}
          onChangeText={setPasteText}
          multiline
          numberOfLines={5}
          placeholder={"8\t1250\t2500\tIS2062\t40\n10\t1500\t3000\t\t25"}
          placeholderTextColor={colors.muted}
          style={s.pasteInput}
        />
        <BButton testID="opening-import" label="IMPORT ROWS" onPress={importPaste} variant="secondary" size="md" />
      </View>

      <View style={s.summary} testID="opening-summary">
        <Text style={s.summaryTxt}>
          READY: <Text style={{ color: colors.brand }}>{totals.lines}</Text> items · <Text style={{ color: colors.brand }}>{totals.pieces}</Text> pcs · ≈<Text style={{ color: colors.brand }}>{totals.weight.toFixed(1)}</Text> kg theoretical
        </Text>
      </View>

      <BButton
        testID="opening-submit"
        label={saving ? t("saving") : `LOAD OPENING STOCK (${totals.lines} ITEMS)`}
        onPress={submit}
        loading={saving}
        disabled={saving || totals.lines === 0}
        size="lg"
      />
    </View>
  );
}

const s = StyleSheet.create({
  infoBox: { padding: spacing.md, backgroundColor: colors.brandTertiary, borderWidth: 1.5, borderColor: colors.brand, marginBottom: spacing.md },
  infoTitle: { fontSize: 12, fontWeight: "900", letterSpacing: 1, color: colors.onSurface, marginBottom: 4 },
  infoTxt: { fontSize: 12, color: colors.onSurface, lineHeight: 18 },
  rowCard: { padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface, marginBottom: spacing.md },
  rowHdr: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs },
  rowTitle: { fontSize: 12, fontWeight: "900", letterSpacing: 2, color: colors.brand },
  rowGrid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 },
  cell: { minWidth: 150, flexGrow: 1, flexBasis: 150, paddingHorizontal: 4 },
  addRow: { paddingVertical: 12, borderWidth: 1.5, borderColor: colors.brand, alignItems: "center", marginBottom: spacing.md },
  addRowTxt: { color: colors.brand, fontWeight: "900", fontSize: 12, letterSpacing: 2 },
  pasteBox: { padding: spacing.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, marginBottom: spacing.md },
  secTitle: { fontSize: 11, fontWeight: "900", letterSpacing: 2, color: colors.muted, marginBottom: 6 },
  pasteHint: { fontSize: 11, color: colors.muted, marginBottom: 8, lineHeight: 16 },
  pasteInput: { borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface, padding: spacing.sm, fontSize: 13, color: colors.onSurface, minHeight: 100, textAlignVertical: "top", marginBottom: spacing.sm, fontFamily: "monospace" },
  summary: { padding: spacing.md, backgroundColor: colors.surfaceInverse, borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.md },
  summaryTxt: { color: colors.onSurfaceInverse, fontWeight: "800", fontSize: 13, letterSpacing: 0.5 },
});
