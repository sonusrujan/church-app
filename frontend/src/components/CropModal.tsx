import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

interface CropModalProps {
  /** The raw File the user selected */
  file: File;
  /** Called with the cropped File when the user confirms */
  onCropped: (croppedFile: File) => void;
  /** Called when the user cancels */
  onCancel: () => void;
  /** Aspect ratio width/height (default 1 = square) */
  aspect?: number;
}

/** Lightweight image crop modal — no external dependencies. */
export default function CropModal({ file, onCropped, onCancel, aspect = 1 }: CropModalProps) {
  const [imgSrc, setImgSrc] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Load file as data URL
  useEffect(() => {
    const reader = new FileReader();
    reader.onload = () => setImgSrc(reader.result as string);
    reader.readAsDataURL(file);
  }, [file]);

  const handleImgLoad = useCallback(() => {
    if (!imgRef.current || !viewportRef.current) return;
    const img = imgRef.current;
    const vpW = viewportRef.current.clientWidth;
    const vpH = viewportRef.current.clientHeight;
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const vpAspect = vpW / vpH;
    // Size the image to cover the viewport while keeping aspect ratio
    if (imgAspect > vpAspect) {
      img.style.width = "auto";
      img.style.height = `${vpH}px`;
    } else {
      img.style.width = `${vpW}px`;
      img.style.height = "auto";
    }
  }, []);

  // Mouse / touch handlers for panning
  const startDrag = useCallback((clientX: number, clientY: number) => {
    setDragging(true);
    setDragStart({ x: clientX - pan.x, y: clientY - pan.y });
  }, [pan]);

  const moveDrag = useCallback((clientX: number, clientY: number) => {
    if (!dragging) return;
    setPan({ x: clientX - dragStart.x, y: clientY - dragStart.y });
  }, [dragging, dragStart]);

  const endDrag = useCallback(() => setDragging(false), []);

  // Mouse events
  const onMouseDown = (e: React.MouseEvent) => { e.preventDefault(); startDrag(e.clientX, e.clientY); };
  const onMouseMove = (e: React.MouseEvent) => moveDrag(e.clientX, e.clientY);
  const onMouseUp = () => endDrag();

  // Touch events
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) startDrag(e.touches[0].clientX, e.touches[0].clientY);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1) moveDrag(e.touches[0].clientX, e.touches[0].clientY);
  };
  const onTouchEnd = () => endDrag();

  // Crop and produce File
  const handleCrop = useCallback(() => {
    if (!imgRef.current || !viewportRef.current) return;

    const vp = viewportRef.current.getBoundingClientRect();
    const img = imgRef.current;
    const imgRect = img.getBoundingClientRect();

    // The crop area is the viewport square
    const cropAreaSize = Math.min(vp.width, vp.height);
    const cropLeft = (vp.width - cropAreaSize * aspect) / 2;
    const cropTop = (vp.height - cropAreaSize) / 2;

    // Map crop area back to image natural coordinates
    const scaleX = img.naturalWidth / imgRect.width;
    const scaleY = img.naturalHeight / imgRect.height;

    const sx = (vp.left + cropLeft - imgRect.left) * scaleX;
    const sy = (vp.top + cropTop - imgRect.top) * scaleY;
    const sw = cropAreaSize * aspect * scaleX;
    const sh = cropAreaSize * scaleY;

    const canvas = document.createElement("canvas");
    const outputW = Math.min(sw, 1200);
    const outputH = Math.min(sh, 1200);
    canvas.width = outputW;
    canvas.height = outputH;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outputW, outputH);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const ext = file.type === "image/png" ? ".png" : ".jpg";
        const cropped = new File([blob], `cropped${ext}`, { type: blob.type });
        onCropped(cropped);
      },
      file.type === "image/png" ? "image/png" : "image/jpeg",
      0.92,
    );
  }, [file, onCropped, aspect]);

  if (!imgSrc) return null;

  // Viewport is the visible crop area — the image overflows and can be panned
  const viewportSize = 280;

  return createPortal(
    <div className="crop-modal-overlay" onClick={onCancel}>
      <div className="crop-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="crop-modal-title">Crop Image</h3>

        <div
          ref={viewportRef}
          className="crop-viewport"
          style={{ width: viewportSize, height: viewportSize / aspect }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <img
            ref={imgRef}
            src={imgSrc}
            alt="Crop preview"
            className="crop-image"
            onLoad={handleImgLoad}
            style={{
              transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
              transformOrigin: "center center",
            }}
            draggable={false}
          />
          <div className="crop-guide" />
        </div>

        <div className="crop-controls">
          <label className="crop-zoom-label">
            <span>Zoom</span>
            <input
              type="range"
              min="1"
              max="3"
              step="0.05"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="crop-zoom-slider"
            />
          </label>
        </div>

        <div className="crop-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleCrop}>Crop & Upload</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
