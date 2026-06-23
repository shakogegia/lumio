// The viewer header title from a photo's capture time. Uses UTC getters so it's
// deterministic (the stored takenAt instant), independent of device timezone —
// and so the unit test isn't TZ-flaky. Falls back to the filename.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatPhotoTitle(photo: { takenAt: string | null; path: string }): {
  title: string;
  subtitle?: string;
} {
  if (photo.takenAt) {
    const d = new Date(photo.takenAt);
    if (!Number.isNaN(d.getTime())) {
      const title = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
      const h = d.getUTCHours();
      const ampm = h < 12 ? "AM" : "PM";
      const h12 = h % 12 || 12;
      const mm = String(d.getUTCMinutes()).padStart(2, "0");
      return { title, subtitle: `${h12}:${mm} ${ampm}` };
    }
  }
  return { title: photo.path.split("/").pop() || photo.path };
}
