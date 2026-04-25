import { useState, useRef } from "react";
import { API_BASE_URL, tryRefreshToken, apiRequest } from "../lib/api";
import CropModal from "./CropModal";
import { useI18n } from "../i18n";

interface PhotoUploadProps {
  /** Current image URL (to display and for old-file cleanup) */
  currentUrl: string;
  /** Called with the new S3 URL after successful upload */
  onUploaded: (url: string) => void;
  /** Called when the photo is deleted — parent should clear the URL */
  onDeleted?: () => void;
  /** Called with error message on upload failure */
  onError?: (message: string) => void;
  /** Auth token */
  token: string;
  /** S3 folder: "avatars", "leaders", or "logos" */
  folder?: "avatars" | "leaders" | "logos" | "banners";
  /** Target church ID for SuperAdmin uploads (when user has no church_id) */
  targetChurchId?: string;
  /** Size of the preview circle in px */
  size?: number;
  /** Fallback content when no image (e.g. initials) */
  fallback?: React.ReactNode;
  /** Disabled state */
  disabled?: boolean;
}

export default function PhotoUpload({
  currentUrl,
  onUploaded,
  onDeleted,
  onError,
  token,
  folder = "avatars",
  targetChurchId,
  size = 80,
  fallback,
  disabled,
}: PhotoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [cropFile, setCropFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  async function handleFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setError(t("photo.errorFileTooLarge"));
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      setError(t("photo.errorFileTypeNotAllowed"));
      return;
    }

    setError("");
    setUploading(true);
    setProgress(0);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("folder", folder);
      if (currentUrl) form.append("old_url", currentUrl);
      if (targetChurchId) form.append("target_church_id", targetChurchId);

      const url = await new Promise<string>((resolve, reject) => {
        function doUpload(authToken: string, isRetry = false) {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", `${API_BASE_URL}/api/uploads/image`);
          xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
          xhr.withCredentials = true;

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              setProgress(Math.round((e.loaded / e.total) * 95));
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const data = JSON.parse(xhr.responseText);
                setProgress(100);
                resolve(data.url);
              } catch {
                reject(new Error("Invalid response"));
              }
            } else if (xhr.status === 401 && !isRetry) {
              // Token expired — try refresh and retry once
              tryRefreshToken().then(newToken => {
                if (newToken) {
                  doUpload(newToken, true);
                } else {
                  reject(new Error("Session expired. Please sign in again."));
                }
              }).catch(() => reject(new Error("Session expired. Please sign in again.")));
            } else {
              try {
                const data = JSON.parse(xhr.responseText);
                reject(new Error(data.error || `Upload failed (${xhr.status})`));
              } catch {
                reject(new Error(`Upload failed (${xhr.status})`));
              }
            }
          };

          xhr.onerror = () => reject(new Error("Network error"));
          xhr.send(form);
        }
        doUpload(token);
      });

      onUploaded(url);
    } catch (err: any) {
      const msg = err.message || t("photo.errorUploadFailed");
      setError(msg);
      onError?.(msg);
    } finally {
      setTimeout(() => {
        setUploading(false);
        setProgress(0);
        setDone(true);
        setTimeout(() => setDone(false), 4000);
      }, 600);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleClick() {
    if (!disabled && !uploading && !deleting) fileInputRef.current?.click();
  }

  async function handleDelete() {
    if (!currentUrl || !onDeleted || deleting) return;
    setDeleting(true);
    setError("");
    try {
      await apiRequest("/api/uploads/image", {
        method: "DELETE",
        token,
        body: { url: currentUrl },
      });
      onDeleted();
    } catch {
      setError(t("photo.errorDeleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    if (disabled || uploading) return;
    const file = e.dataTransfer.files[0];
    if (file) showCrop(file);
  }

  function showCrop(file: File) {
    if (file.size > 5 * 1024 * 1024) { setError(t("photo.errorFileTooLarge")); return; }
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      setError(t("photo.errorFileTypeNotAllowed")); return;
    }
    setError("");
    setCropFile(file);
  }

  // SVG progress ring calculations
  const ringSize = size + 8;
  const radius = (ringSize - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className="photo-upload-wrapper">
      <div
        className={`photo-upload-circle${uploading ? " uploading" : ""}${done && !error ? " upload-done" : ""}${disabled ? " disabled" : ""}`}
        style={{ width: size, height: size }}
        onClick={handleClick}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        role="button"
        tabIndex={disabled ? -1 : 0}
        title={disabled ? "" : t("photo.uploadHint")}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClick(); }}
      >
        {uploading ? (
          <div className="photo-upload-progress-container">
            <svg
              className="photo-upload-ring"
              width={ringSize}
              height={ringSize}
              viewBox={`0 0 ${ringSize} ${ringSize}`}
            >
              <circle
                className="photo-upload-ring-bg"
                cx={ringSize / 2}
                cy={ringSize / 2}
                r={radius}
                strokeWidth="3"
              />
              <circle
                className="photo-upload-ring-fill"
                cx={ringSize / 2}
                cy={ringSize / 2}
                r={radius}
                strokeWidth="3"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
              />
            </svg>
            <span className="photo-upload-progress-text">
              {progress < 100 ? `${progress}%` : "✓"}
            </span>
          </div>
        ) : currentUrl ? (
          <img src={currentUrl} alt="Photo" className="photo-upload-img" loading="lazy" />
        ) : fallback ? (
          <>{fallback}</>
        ) : (
          <span className="photo-upload-placeholder">📷</span>
        )}
        {!disabled && !uploading && (
          <span className="photo-upload-overlay">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </span>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) showCrop(f); if (fileInputRef.current) fileInputRef.current.value = ""; }}
        style={{ display: "none" }}
      />
      {error && <span className="field-error" style={{ display: "block", marginTop: 4, fontSize: "0.78rem" }}>{error}</span>}
      {done && !error && <span className="photo-upload-success-text">✓ Uploaded successfully</span>}
      {onDeleted && currentUrl && !uploading && !deleting && (
        <button
          type="button"
          className="photo-upload-delete-btn"
          onClick={handleDelete}
          title={t("photo.removeButton")}
        >
          ✕
        </button>
      )}
      {deleting && <span style={{ display: "block", marginTop: 4, fontSize: "0.78rem", opacity: 0.6 }}>Removing…</span>}
      {cropFile && (
        <CropModal
          file={cropFile}
          onCropped={(cropped) => { setCropFile(null); handleFile(cropped); }}
          onCancel={() => setCropFile(null)}
        />
      )}
    </div>
  );
}
