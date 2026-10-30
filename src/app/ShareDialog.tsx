import { useEffect, useRef, useState } from "react";
import type { InventoryItem, Space } from "../model/types.ts";
import { planToShare, shareLink } from "../share/share.ts";

interface Props {
  open: boolean;
  space: Space;
  inventory: InventoryItem[];
  clearances: Record<string, number>;
  onClose: () => void;
}

/** Some messaging apps cut very long links. */
const LONG_LINK = 8000;

export function ShareDialog({ open, space, inventory, clearances, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLink(null);
    setCopied(false);
    shareLink(planToShare(space, inventory, clearances), `${location.origin}${location.pathname}`).then((l) => live && setLink(l));
    return () => {
      live = false;
    };
  }, [open, space, inventory, clearances]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard blocked: the link is selected in the box so it can be copied by hand.
      document.querySelector<HTMLInputElement>(".share-link")?.select();
    }
  };
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  return (
    <dialog ref={ref} onClose={onClose} className="settings">
      <h2>Share this plan</h2>
      <p>Anyone with this link can see the rooms of {space.name || "this listing"}, the furniture you've placed and whether each piece fits.</p>
      <input className="share-link" type="text" readOnly value={link ?? "Making the link…"} aria-label="Share link" onFocus={(e) => e.target.select()} />
      <div className="row wrap">
        <button disabled={!link} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy link"}
        </button>
        {canShare && (
          <button className="secondary" disabled={!link} onClick={() => link && navigator.share({ title: space.name || "Alcove Home plan", url: link }).catch(() => {})}>
            Send…
          </button>
        )}
      </div>
      {link && link.length > LONG_LINK && <p className="note">This is a long link. Some messaging apps may cut it off; email works best.</p>}
      <ul className="hint">
        <li>The plan is inside the link itself. It isn't uploaded anywhere.</li>
        <li>The link is a snapshot. If you change the plan, share it again.</li>
        <li>The original floor plan picture isn't included.</li>
      </ul>
      <button className="secondary" onClick={onClose}>
        Done
      </button>
    </dialog>
  );
}
