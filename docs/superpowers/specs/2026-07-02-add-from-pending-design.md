# Add From Pending — link pending items inside the expense dialog

**Status:** Approved 2026-07-02
**Author:** Senthil + Claude
**Migration:** `034_attach_pending_items.sql`
**Follows:** `2026-06-24-line-item-followups-design.md` (shipped as 033)

## Problem

Pending items can only become an expense through the Bundle flow on the Pending
Items tab, which always creates a *new* expense. There is no bridge from the
Add/Edit Expense dialog: a treasurer mid-way through recording an expense
cannot pull waiting pending items in as line items, and there is no way to fold
pending items into an already-created expense.

## Decisions (user-confirmed)

1. **Where:** the "Add from pending" button appears in BOTH add mode and edit
   mode of `AddExpenseDialog`.
2. **Save mechanics:** small dedicated RPC (`attach_pending_items`), not a
   mega-RPC. Header + all line items (manual and pending-derived, with any
   user edits) save through the existing client-side path; the RPC only
   validates, promotes receipts, and deletes the pending originals.
3. **Header amount:** auto-adds each picked item's amount on pick, subtracts
   on removal. User can still override manually before saving.
4. **Edits win:** a picked item is raw material. If the user edits its amount
   or description in the form, the edited value is what's recorded; the
   pending original is deleted regardless.

## Data model

No schema changes. Migration `034_attach_pending_items.sql` contains only the
new RPC + GRANT.

### RPC `attach_pending_items(p_expense_id uuid, p_ids uuid[]) RETURNS jsonb`

`SECURITY DEFINER`, `SET search_path = public`, admin-only via
`get_my_role()`. Steps:

1. Guard: `p_ids` non-empty; expense `p_expense_id` exists and
   `voided_at IS NULL`.
2. Lock + validate the pending rows:
   `SELECT ... WHERE id = ANY(p_ids) AND voided_at IS NULL FOR UPDATE` —
   count must equal `cardinality(p_ids)`, else raise.
3. Corpus consistency: every picked item's `corpus_plan_id` must be
   *not distinct from* the expense's `corpus_plan_id` (NULL = maintenance
   matches NULL), else raise.
4. Promote receipts:
   `INSERT INTO expense_attachments (expense_id, file_name, file_url, uploaded_by)
    SELECT p_expense_id, attachment_name, attachment_url, auth.uid()
    FROM pending_line_items
    WHERE id = ANY(p_ids) AND voided_at IS NULL AND attachment_url IS NOT NULL`.
5. Hard-delete the originals: `DELETE ... WHERE id = ANY(p_ids)`.
6. Return `jsonb_build_object('deleted', <count>, 'attachments', <count>)`.

**Deliberate difference from `bundle_pending_items`:** this RPC does NOT
insert line items and does NOT touch the expense header. The client writes
the pending-derived line items (with any user edits) through the normal
`expense_line_items` insert, and the client computed the header amount
already. The RPC's job is purely: lock, validate, carry receipts, delete.

## UI changes — all in `src/pages/ExpensesPage.tsx`

### Form state

`lineItemSchema` gains one optional field: `pending_id: z.string().optional()`.
A line item row with `pending_id` set came from the picker; rows without it
are manual. `pending_id` is *never written to the DB* — it is stripped from
`linePayloads` and used only at save time to know which pending originals to
attach/delete and to prevent double-picking.

### "Add from pending" button

Rendered next to the existing "Add line item" button (both gated on
`canWrite`). Always visible; if no compatible pending items exist the picker
opens with an empty state ("No pending items match this expense").

### Picker dialog (`PendingPickerDialog`)

- Lists active pending items (`voided_at IS NULL`), sorted `paid_date DESC,
  created_at DESC` (same as the Pending tab).
- Filters out items whose `corpus_plan_id` differs from the form's current
  `corpus_plan_id` (empty/undefined = maintenance = NULL plan).
- Filters out items already picked into the form (`pending_id` present in
  the field array).
- Each row: checkbox, date, description, payee name, amount, paperclip icon
  when `attachment_url` is set.
- Footer shows count + total of ticked items; Confirm appends them.

### On confirm (append to form)

For each ticked pending item, `append({...})` a line item pre-filled with:
`description`, `payee_type`, `staff_id`, `vendor_id`, `payee_name_raw`,
`category_id`, `cost_center`, `amount`, `paid_date`, `payment_mode`,
`reference_no`, and `pending_id: item.id`. Then bump the header `amount`
field by the item's amount (`setValue('amount', current + item.amount)`).

### On remove of a picked row

The existing per-row trash button works unchanged; additionally, when the
removed row has a `pending_id`, subtract its *current form amount* from the
header amount. The pending original is untouched (it never left the pending
list — nothing is deleted until save succeeds).

### Save flow (`onSubmit`)

1. Save the expense header and ALL line items exactly as today (edits
   included; `pending_id` stripped from payloads).
2. Collect `pendingIds` = the `pending_id` values present in the submitted
   line items. If non-empty, call
   `supabase.rpc('attach_pending_items', { p_expense_id, p_ids: pendingIds })`.
3. On RPC failure: toast the error. The expense exists with all its line
   items; the pending items remain in the pending list. The failure state is
   visible (items still pending) and recoverable (user can delete the stale
   pending items manually, or retry via edit → re-pick is NOT possible since
   the lines already exist — so the toast copy must say: "Expense saved, but
   N pending items could not be cleared — remove them from the Pending tab
   manually.").
4. Invalidate both the expenses and pending-items queries.

### Edit mode specifics

Same button, same picker, same flow. Loaded line items from the DB have no
`pending_id` (it is not persisted), so they are never double-cleared.

## Out of scope

- Editing the receipt of a picked item inside the expense form (receipts
  carry over as-is).
- Multi-select "add all" shortcut.
- Committee/auditor roles seeing the button (write-gated as all mutations).

## Acceptance

- Add mode: pick 2 pending items (one with receipt) + 1 manual line → save →
  day book shows 3 line items with correct dates/payees; receipt appears in
  Attachments; both pending items gone from the Pending tab.
- Edit mode: open an existing expense → Add from pending → pick 1 → save →
  line item added, header amount includes it, pending item cleared.
- Edited pick: change a picked item's amount before save → day book shows
  the edited amount; pending original still deleted.
- Removal: pick an item, then remove its row before save → item still in
  the Pending tab, header amount restored.
- Corpus: expense with corpus plan A never lists maintenance or plan-B
  pending items in the picker.
- Concurrency: item voided after picker opened but before save → RPC raises,
  toast shows the manual-cleanup message, expense keeps its line items.
