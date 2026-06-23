import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LargeHeaderOverlay, useScrollEdgeHeader } from "@/components/large-header";
import { SettingsMenuButton } from "@/components/settings-menu-button";
import { ZoomablePhotoGrid } from "@/components/photo-grid";
import { usePhotoPages } from "@/hooks/use-photo-pages";
import { fetchPhotos } from "@/lib/photos-api";
import { useAuth } from "@/contexts/auth-context";
import { useCatalogs } from "@/contexts/catalog-context";
import { useTheme } from "@/lib/theme";

// Persisted grid density (column count), like the active catalog persists.
const ZOOM_KEY = "lumio.photoGridZoom";
const ZOOM_LEVELS = [1, 3, 5, 8];
const DEFAULT_COLUMNS = 3;

export default function Photos() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { serverUrl, getCookie } = useAuth();
  const { activeCatalog, isLoading: catalogLoading, error: catalogError } = useCatalogs();
  const { scrolled, anim, onScroll, headerHeight } = useScrollEdgeHeader();

  const slug = activeCatalog?.slug ?? null;
  const cookie = getCookie();

  // Restore the persisted zoom once on mount.
  const [initialColumns, setInitialColumns] = useState(DEFAULT_COLUMNS);
  const [zoomReady, setZoomReady] = useState(false);
  useEffect(() => {
    SecureStore.getItemAsync(ZOOM_KEY)
      .then((v) => {
        const n = v ? Number(v) : NaN;
        if (ZOOM_LEVELS.includes(n)) setInitialColumns(n);
      })
      .finally(() => setZoomReady(true));
  }, []);

  const onColumnsChange = useCallback((cols: number) => {
    void SecureStore.setItemAsync(ZOOM_KEY, String(cols));
  }, []);

  // Memoized per data source so usePhotoPages reloads only when the source
  // changes. cookie is captured by value (a stable string per session).
  const fetchPage = useMemo(
    () =>
      serverUrl && slug
        ? (offset: number, limit: number) => fetchPhotos(serverUrl, slug, cookie, { limit, offset })
        : null,
    [serverUrl, slug, cookie],
  );

  const { photos, isLoading, isLoadingMore, error, loadMore, refetch } = usePhotoPages({ fetchPage });

  const errMsg = error ?? catalogError;
  // Any error takes precedence over the spinner so it can't be masked.
  const showSpinner =
    !zoomReady || (!errMsg && (catalogLoading || (isLoading && photos.length === 0)));

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {showSpinner ? (
        <View style={[styles.center, { paddingTop: headerHeight }]}>
          <ActivityIndicator />
        </View>
      ) : errMsg && photos.length === 0 ? (
        <View style={[styles.center, { paddingTop: headerHeight }]}>
          <Text style={[styles.msg, { color: colors.mutedForeground }]}>{errMsg}</Text>
          <Text onPress={refetch} style={[styles.retry, { color: colors.primary }]}>
            Retry
          </Text>
        </View>
      ) : (
        <ZoomablePhotoGrid
          photos={photos}
          baseURL={serverUrl ?? ""}
          slug={slug ?? ""}
          cookie={cookie}
          zoomLevels={ZOOM_LEVELS}
          initialColumns={initialColumns}
          onColumnsChange={onColumnsChange}
          onEndReached={loadMore}
          onScroll={onScroll}
          contentInset={{ top: headerHeight + 8, bottom: insets.bottom + 96 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.msg, { color: colors.mutedForeground }]}>No photos yet</Text>
            </View>
          }
          ListFooterComponent={
            isLoadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator />
              </View>
            ) : null
          }
        />
      )}
      <LargeHeaderOverlay
        title="Photos"
        right={<SettingsMenuButton />}
        scrolled={scrolled}
        anim={anim}
        headerHeight={headerHeight}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  empty: { alignItems: "center", paddingTop: 64 },
  msg: { fontSize: 15 },
  retry: { fontSize: 15, fontWeight: "600" },
  footer: { paddingVertical: 24, alignItems: "center" },
});
