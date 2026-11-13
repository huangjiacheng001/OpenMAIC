'use client';

import { Button } from '@/components/ui/button';
import { useRef, useState } from 'react';
import { ArrowUp, Camera, Crop, RotateCw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { MAX_TUTOR_PHOTO } from '@/lib/tutor/protocol';
import styles from './family-workspace.module.css';

type Point = { x: number; y: number };
type Area = Point & { width: number; height: number };

async function editImage(src: string, area?: Area) {
  const image = new Image();
  image.src = src;
  await image.decode();
  const width = image.naturalWidth,
    height = image.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = area ? Math.max(1, Math.round(area.width * width)) : height;
  canvas.height = area ? Math.max(1, Math.round(area.height * height)) : width;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Cannot process photo');
  if (area) {
    context.drawImage(
      image,
      area.x * width,
      area.y * height,
      area.width * width,
      area.height * height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  } else {
    context.translate(height, 0);
    context.rotate(Math.PI / 2);
    context.drawImage(image, 0, 0);
  }
  for (const quality of [0.84, 0.68, 0.5, 0.36]) {
    const output = canvas.toDataURL('image/jpeg', quality);
    if (output.length <= MAX_TUTOR_PHOTO) return output;
  }
  throw new Error('Edited photo is too large');
}

export function HomeworkPhotoPreview({
  photo,
  onClose,
  onEdit,
  onSend,
  onRetake,
}: {
  photo: string;
  onClose: () => void;
  onEdit: (photo: string) => void;
  onSend: () => void;
  onRetake: () => void;
}) {
  const [cropping, setCropping] = useState(false);
  const [area, setArea] = useState<Area>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const start = useRef<Point>(null);
  function point(element: HTMLElement, x: number, y: number): Point {
    const box = element.getBoundingClientRect();
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    return { x: clamp((x - box.left) / box.width), y: clamp((y - box.top) / box.height) };
  }
  async function edit(selection?: Area) {
    setBusy(true);
    setError(false);
    try {
      onEdit(await editImage(photo, selection));
      setCropping(false);
      setArea(undefined);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className={styles.photoDialog}>
        <DialogTitle>照片预览</DialogTitle>
        <DialogDescription>确认要问的题拍清楚了，可以调整范围或直接发送。</DialogDescription>
        <div
          className={styles.cropSurface}
          data-cropping={cropping}
          onPointerDown={(event) => {
            if (!cropping || busy) return;
            start.current = point(event.currentTarget, event.clientX, event.clientY);
            event.currentTarget.setPointerCapture(event.pointerId);
            setArea(undefined);
          }}
          onPointerMove={(event) => {
            if (!start.current) return;
            const from = start.current,
              to = point(event.currentTarget, event.clientX, event.clientY);
            setArea({
              x: Math.min(from.x, to.x),
              y: Math.min(from.y, to.y),
              width: Math.abs(to.x - from.x),
              height: Math.abs(to.y - from.y),
            });
          }}
          onPointerUp={() => {
            start.current = null;
          }}
          onPointerCancel={() => {
            start.current = null;
          }}
        >
          <img src={photo} alt="作业照片预览" draggable={false} />
          {cropping && area && (
            <span
              aria-hidden="true"
              className={styles.cropArea}
              style={{
                left: area.x * 100 + '%',
                top: area.y * 100 + '%',
                width: area.width * 100 + '%',
                height: area.height * 100 + '%',
              }}
            />
          )}
        </div>
        {cropping && <p className={styles.muted}>在照片上拖出要保留的范围。</p>}
        {error && (
          <p className={styles.alert} role="alert">
            照片未能处理，可以重试或发送原照片。
          </p>
        )}
        <div className={styles.actions}>
          {cropping ? (
            <>
              <Button
                size="touch"
                variant="outline"
                disabled={busy || !area || area.width < 0.03 || area.height < 0.03}
                onClick={() => void edit(area)}
              >
                应用范围
              </Button>
              <Button
                size="touch"
                variant="ghost"
                className="text-primary-text"
                disabled={busy}
                onClick={() => {
                  setCropping(false);
                  setArea(undefined);
                }}
              >
                取消裁切
              </Button>
            </>
          ) : (
            <>
              <Button
                size="touch"
                variant="outline"
                disabled={busy}
                onClick={() => setCropping(true)}
              >
                <Crop size={17} />
                调整范围
              </Button>
              <Button size="touch" variant="outline" disabled={busy} onClick={() => void edit()}>
                <RotateCw size={17} />
                旋转
              </Button>
              <Button
                size="touch"
                variant="ghost"
                className="text-primary-text"
                disabled={busy}
                onClick={onRetake}
              >
                <Camera size={17} />
                重拍
              </Button>
            </>
          )}
        </div>
        <Button type="button" size="touch" disabled={busy || cropping} onClick={onSend}>
          <ArrowUp size={18} aria-hidden="true" />
          发送
        </Button>
      </DialogContent>
    </Dialog>
  );
}
