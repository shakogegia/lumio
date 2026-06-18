import Image from "next/image";
import { cn } from "@/lib/utils";

const PHOTO_IDS = [
  "1506744038136-46273834b3fb",
  "1469474968028-56623f02e42e",
  "1470071459604-3b5ec3a7fe05",
  "1418065460487-3e41a6c84dc5",
  "1501785888041-af3ef285b470",
  "1441974231531-c6227db76b6e",
  "1439066615861-d1af74d74000",
  "1500530855697-b586d89ba3ee",
  "1497436072909-60f360e1d4b1",
];

function src(id: string) {
  return `https://images.unsplash.com/photo-${id}?w=480&h=600&fit=crop&q=80`;
}

/** Pick 3 distinct ids — runs per request on the force-dynamic auth pages. */
function pickThree(): string[] {
  const a = [...PHOTO_IDS];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, 3);
}

function Card({ id, className }: { id: string; className?: string }) {
  return (
    <div
      className={cn(
        "absolute overflow-hidden rounded-2xl border-4 border-background bg-background shadow-xl",
        className,
      )}
    >
      <Image
        src={src(id)}
        alt=""
        width={200}
        height={250}
        className="h-full w-full object-cover"
      />
    </div>
  );
}

export function AuthPhotoStack() {
  const [back, front, side] = pickThree();
  return (
    <div className="relative h-[440px] w-[360px]" aria-hidden>
      <Card id={back} className="left-3 top-20 h-[260px] w-[190px] -rotate-6" />
      <Card id={side} className="right-3 top-24 h-[250px] w-[185px] rotate-6" />
      <Card
        id={front}
        className="left-1/2 top-8 z-10 h-[300px] w-[215px] -translate-x-1/2 -rotate-1"
      />
    </div>
  );
}
