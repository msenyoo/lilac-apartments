-- Quantity × Rate tracking (utility_units/utility_rate) was gated behind is_utility
-- categories only, using the category's fixed unit_label (kWh, KL, trips). Non-utility
-- line items also have a natural quantity+unit (5 liters of Lizol, 3 bulbs) that varies
-- per item, not per category — so the unit needs to live on the line item itself, editable,
-- defaulting from the category's unit_label when one exists.
alter table public.expense_line_items add column if not exists unit_label text;
