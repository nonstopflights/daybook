'use client';

import {useEffect, useRef, useState, type RefObject} from 'react';
import {ArrowUp, Loader2, Plus, X} from 'lucide-react';
import {Button} from './ui/button';
import {compressImage} from '@/lib/image-compression';
import {type Attachment} from '@/lib/types';

type PendingImage = {id: string; file: File; preview: string; attachment?: Attachment};

export function CaptureInput({value, onChange, inputRef, onSave}: {
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onSave: (attachments: Attachment[]) => Promise<boolean>;
}) {
  const [images, setImages] = useState<PendingImage[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const previews = useRef(new Set<string>());
  useEffect(() => () => {
    for (const url of previews.current) URL.revokeObjectURL(url);
    previews.current.clear();
  }, []);

  async function save() {
    if (busy.current || (!value.trim() && !images.length)) return;
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      const attachments: Attachment[] = [];
      for (const image of images) {
        let attachment = image.attachment;
        if (!attachment) {
          const file = await compressImage(image.file);
          const form = new FormData();
          form.append('file', file);
          const response = await fetch('/api/upload', {method: 'POST', body: form});
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Could not upload this image');
          attachment = data as Attachment;
          // Keep successful uploads so a failed save can be retried without uploading again.
          setImages(current => current.map(item => item.id === image.id ? {...item, attachment} : item));
        }
        attachments.push(attachment);
      }
      if (await onSave(attachments)) {
        for (const url of previews.current) URL.revokeObjectURL(url);
        previews.current.clear();
        setImages([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this thought');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return <>
    <form className="capture-box" onSubmit={e => {e.preventDefault(); void save();}}>
      <span className="capture-icon"><Plus size={22}/></span>
      <input ref={inputRef} aria-label="Capture a thought" placeholder="What’s on your mind?" value={value}
        disabled={saving} onChange={e => onChange(e.target.value)} maxLength={10000}
        onPaste={e => {
          const files = Array.from(e.clipboardData.items)
            .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
            .map(item => item.getAsFile()).filter((file): file is File => !!file);
          if (!files.length) return;
          e.preventDefault();
          if (busy.current) return;
          const added = files.map(file => {
            const preview = URL.createObjectURL(file);
            previews.current.add(preview);
            return {id: crypto.randomUUID(), file, preview};
          });
          setImages(current => [...current, ...added]);
          setError('');
          // Preserve a caption when the clipboard contains both text and images.
          const text = e.clipboardData.getData('text/plain');
          if (text) {
            const start = e.currentTarget.selectionStart ?? value.length;
            const end = e.currentTarget.selectionEnd ?? start;
            onChange((value.slice(0, start) + text + value.slice(end)).slice(0, 10000));
          }
        }}/>
      <Button size="icon" disabled={saving || (!value.trim() && !images.length)} aria-label="Save thought">
        {saving ? <Loader2 size={20} className="spin"/> : <ArrowUp size={20}/>}
      </Button>
    </form>
    {images.length > 0 && <div className="capture-images" aria-label="Images to include in your note">
      {images.map(image => <div className="capture-image" key={image.id}>
        <img src={image.preview} alt={image.file.name || 'Pasted image'}/>
        <button type="button" aria-label={'Remove image ' + image.file.name} disabled={saving} onClick={() => {
          URL.revokeObjectURL(image.preview);
          previews.current.delete(image.preview);
          setImages(current => current.filter(item => item.id !== image.id));
        }}><X size={14}/></button>
      </div>)}
    </div>}
    <div className="capture-hint">Paste text or images. Saved to #inbox with no due date. Add #tags to file it elsewhere.</div>
    {error && <p className="error" role="alert">{error}</p>}
  </>;
}
