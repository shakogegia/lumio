"use client";

import { createContext, useContext } from "react";

/** What a photo surface lets the viewer do. Default (authed) = everything. A
 *  restricted surface (e.g. the public share gallery) provides a subset; the
 *  shared action UIs render each control only when its capability is true. */
export interface PhotoCapabilities {
  download: boolean;
  downloadAll: boolean;
  favorite: boolean;
  label: boolean;        // color label
  addToAlbum: boolean;
  setCover: boolean;
  trash: boolean;
  edit: boolean;         // the editor / edit tab
  details: boolean;      // info / EXIF / edit sidebar
  createShare: boolean;  // create a share link
}

export const ALL_CAPABILITIES: PhotoCapabilities = {
  download: true, downloadAll: true, favorite: true, label: true,
  addToAlbum: true, setCover: true, trash: true, edit: true,
  details: true, createShare: true,
};

const PhotoCapabilitiesContext = createContext<PhotoCapabilities | null>(null);

export function PhotoCapabilitiesProvider({
  value, children,
}: { value: PhotoCapabilities; children: React.ReactNode }) {
  return <PhotoCapabilitiesContext.Provider value={value}>{children}</PhotoCapabilitiesContext.Provider>;
}

/** Capabilities for the current surface; all-true when no provider (authed default). */
export function usePhotoCapabilities(): PhotoCapabilities {
  return useContext(PhotoCapabilitiesContext) ?? ALL_CAPABILITIES;
}
