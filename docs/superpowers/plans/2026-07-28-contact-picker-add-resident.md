# Pick-from-contacts for Add Resident Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a committee member tap "Pick from contacts" while adding a new resident and have Name/Phone/Email auto-fill from a contact selected via the browser's Contact Picker API, on browsers that support it (Chrome for Android only).

**Architecture:** One file, `src/pages/FlatsPage.tsx`, already contains `ResidentModal` (add + edit resident dialog). This plan adds a feature-detected button to its add-mode form that calls `navigator.contacts.select(...)` and fills existing form state (`name`, `phone`, `email`) — no new component, no schema change. A new ambient-types file teaches TypeScript about the Contact Picker API, which isn't in `lib.dom.d.ts`.

**Tech Stack:** React 18 + TypeScript, native browser Contact Picker API (`navigator.contacts.select`), `lucide-react` icons, `sonner` toasts (already used in this file).

**Design doc:** `docs/superpowers/specs/2026-07-28-contact-picker-add-resident-design.md`

## Global Constraints

- Repo is **PUBLIC**: no real resident data in any file this plan touches.
- `npx tsc --noEmit` must pass before every commit — this project has `noUnusedLocals` and `noUnusedParameters` enabled, so don't introduce an import/const/function in one task that isn't used until a later task.
- No database migrations — this is a client-side-only change to how the existing add-resident form gets filled in before submit.
- The "Pick from contacts" button must be feature-detected: rendered only when `supportsContactPicker` is true, and only in add mode (`!isEdit`) — never in edit mode, never as a disabled/tooltip state on unsupported browsers.
- No automated test coverage is possible for the picker itself: `navigator.contacts` doesn't exist in any browser engine Playwright drives (including its Chromium build). Verification for the picker flow is manual, on an actual Android Chrome device. `npx tsc --noEmit` is still the automated gate for every task.

---

### Task 1: Ambient TypeScript declarations for the Contact Picker API

**Files:**
- Create: `src/types/contact-picker.d.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: global ambient types `ContactInfo`, `ContactsManager`, and augmentations to the global `Navigator` (`contacts?: ContactsManager`) and `Window` (`ContactsManager?: unknown`) interfaces — available project-wide with no import needed, consumed by Task 2.

- [ ] **Step 1: Create the ambient declarations file**

Create `src/types/contact-picker.d.ts`:

```ts
interface ContactInfo {
  name: string[]
  tel: string[]
  email: string[]
}

interface ContactsManager {
  select(properties: string[], options?: { multiple?: boolean }): Promise<ContactInfo[]>
}

interface Navigator {
  contacts?: ContactsManager
}

interface Window {
  ContactsManager?: unknown
}
```

This file needs no explicit reference anywhere — TypeScript's default `include: ["src"]` in `tsconfig.json` picks up every `.d.ts` under `src/` automatically (the same way `src/vite-env.d.ts` already works), and these are global ambient augmentations, not a module (no top-level `import`/`export`), so they merge into the built-in `Navigator`/`Window` types everywhere in the project.

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors. (Nothing references these types yet — that's fine; ambient global interface declarations are not subject to `noUnusedLocals`, unlike a concrete unused variable or function would be.)

- [ ] **Step 3: Commit**

```bash
git add src/types/contact-picker.d.ts
git commit -m "$(cat <<'EOF'
feat(types): add ambient declarations for the Contact Picker API

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Wire "Pick from contacts" into ResidentModal (add mode)

**Files:**
- Modify: `src/pages/FlatsPage.tsx:1-16` (imports + module-scope constants), `src/pages/FlatsPage.tsx:639-736` (`ResidentModal`)

**Interfaces:**
- Consumes: `Navigator.contacts` / `ContactInfo` global ambient types (Task 1).
- Produces: nothing consumed by later tasks — this is the full feature, self-contained.

- [ ] **Step 1: Add the `Contact` icon to the existing lucide-react import**

In `src/pages/FlatsPage.tsx`, change line 5 from:

```tsx
import { Edit2, Ruler, UserMinus, UserPlus, Pencil, Trash2 } from 'lucide-react'
```

to:

```tsx
import { Edit2, Ruler, UserMinus, UserPlus, Pencil, Trash2, Contact } from 'lucide-react'
```

- [ ] **Step 2: Add module-scope feature-detection constant and phone normalizer**

In `src/pages/FlatsPage.tsx`, after line 16 (`const RELATIONS = ['Self', 'Co-owner', 'Spouse', 'Parent', 'Child', 'Guardian', 'Other'] as const`), add:

```tsx

const supportsContactPicker = typeof navigator !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in window

function normalizePickedPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits
}
```

`normalizePickedPhone` strips everything but digits, then drops a leading `91` country-code prefix
when the result is exactly 12 digits (e.g. a contact stored as `+91 98765 43210` becomes
`9876543210`), matching the bare-10-digit convention the Phone field already uses elsewhere in
this form (placeholder `"9876543210"`). Any other digit string — a landline, a foreign number, a
malformed entry — passes through unchanged; the field stays hand-editable after picking, so a
best-effort normalization is enough.

- [ ] **Step 3: Add `picking` state to `ResidentModal`**

In `ResidentModal` (`src/pages/FlatsPage.tsx`), change:

```tsx
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
```

to:

```tsx
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [picking, setPicking] = useState(false)
```

- [ ] **Step 4: Add the `handlePickContact` function**

In `ResidentModal`, immediately after the closing brace of `handleSave` (i.e. right before the
`return (` that starts the JSX), add:

```tsx

  async function handlePickContact() {
    setPicking(true)
    try {
      const contacts = await navigator.contacts!.select(['name', 'tel', 'email'], { multiple: false })
      if (contacts.length === 0) return
      const c = contacts[0]
      if (c.name[0]) setName(c.name[0])
      if (c.tel[0]) setPhone(normalizePickedPhone(c.tel[0]))
      if (c.email[0]) setEmail(c.email[0])
    } catch {
      toast.error('Could not access contacts')
    } finally {
      setPicking(false)
    }
  }
```

`navigator.contacts!` (non-null assertion) is safe here because this function is only ever
invoked from a button that's rendered exclusively when `supportsContactPicker` is `true` (Step 5),
which already confirms `navigator.contacts` exists. An empty `contacts` array means the user
cancelled the native picker — that resolves the promise rather than rejecting it, so it's handled
as a silent early return, not an error. Each field is only overwritten when its array entry is
non-empty, so e.g. a contact with no email leaves the Email field untouched. The `picking` guard
prevents a second `select()` call while one is still pending, which would otherwise throw
`InvalidStateError` per the Contact Picker spec.

- [ ] **Step 5: Add the button to the JSX, above the Full name field**

In `ResidentModal`'s return statement, change:

```tsx
            <p className="text-[11px] mt-1" style={{ color: 'var(--ink-400)' }}>Who this person is — e.g. the owner's spouse, or the tenant themself (Self)</p>
          </div>
          <Field label="Full name *" value={name} onChange={setName} placeholder="e.g. Ramesh Kumar" />
```

to:

```tsx
            <p className="text-[11px] mt-1" style={{ color: 'var(--ink-400)' }}>Who this person is — e.g. the owner's spouse, or the tenant themself (Self)</p>
          </div>
          {!isEdit && supportsContactPicker && (
            <button type="button" onClick={handlePickContact} disabled={picking}
              className="btn-secondary w-full text-sm flex items-center justify-center gap-1.5">
              <Contact size={14} /> {picking ? 'Choosing…' : 'Pick from contacts'}
            </button>
          )}
          <Field label="Full name *" value={name} onChange={setName} placeholder="e.g. Ramesh Kumar" />
```

- [ ] **Step 6: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual check — unsupported browser (desktop)**

`npm run dev`, open `/flats` on desktop Chrome (or whatever desktop browser is at hand) → Residents
tab → "Add resident". Confirm the dialog opens exactly as before, with **no** "Pick from contacts"
button visible, and that typing name/phone/email/saving all still work unchanged. This confirms
`supportsContactPicker` correctly evaluates to `false` and the feature is fully inert there.

- [ ] **Step 8: Manual check — supported browser (Android Chrome)**

The Contact Picker API (`navigator.contacts`) is spec'd as `[SecureContext]` — it does not exist at
all on a plain `http://` origin, even one reachable over LAN. Test against an HTTPS origin: the
deployed Vercel URL (https://lilac-apartments.vercel.app) or a Vercel preview deployment URL.
`npm run dev` reachable over LAN (`http://192.168.x.x:5173`) will **not** work — `supportsContactPicker`
will evaluate to `false` and the button simply won't render, which could be wrongly read as the
feature being broken. If you need to test against a local dev server anyway, enable the
`chrome://flags` → "Insecure origins treated as secure" flag for that origin first — a bare LAN
HTTP URL will not work without it (or without HTTPS).

On an Android device running Chrome, open one of the HTTPS origins above → Flats → Residents tab
→ "Add resident". Confirm:
- The "Pick from contacts" button is visible above the Full name field.
- Tapping it opens the native Android contact picker; selecting a contact fills Name, Phone, and
  Email (when the contact has those fields) and the button briefly shows "Choosing…" while
  waiting.
- A contact whose number is stored as `+91 XXXXX XXXXX` fills the Phone field as a bare 10-digit
  number.
- Cancelling the native picker returns to the form unchanged, with no error toast.
- Saving the form after picking a contact creates the resident correctly (check the Residents
  grid).
- Opening "Edit resident" on any existing row shows **no** "Pick from contacts" button.

- [ ] **Step 9: Commit**

```bash
git add src/pages/FlatsPage.tsx
git commit -m "$(cat <<'EOF'
feat(residents): add pick-from-contacts button to Add Resident (Android Chrome)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
