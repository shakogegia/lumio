import { afterEach, describe, expect, it, vi } from "vitest";
import { SoundEffect, SOUND_VOLUME } from "./registry.js";
import { playSound, setSoundEnabled } from "./player.js";

class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string;
  volume = 1;
  currentTime = 0;
  playCalls = 0;
  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }
  play(): Promise<void> {
    this.playCalls++;
    return Promise.resolve();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeAudio.instances = [];
  setSoundEnabled(true); // reset module flag for the next test
});

describe("playSound", () => {
  it("constructs an Audio for the effect URL and plays it when enabled", () => {
    vi.stubGlobal("Audio", FakeAudio);
    setSoundEnabled(true);
    playSound(SoundEffect.MoveToTrash);
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].src).toContain("move-to-trash");
    expect(FakeAudio.instances[0].volume).toBe(SOUND_VOLUME);
    expect(FakeAudio.instances[0].playCalls).toBe(1);
  });

  it("does nothing when sounds are disabled", () => {
    vi.stubGlobal("Audio", FakeAudio);
    setSoundEnabled(false);
    playSound(SoundEffect.EmptyTrash);
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("swallows a rejected play() promise without throwing", () => {
    class RejectingAudio extends FakeAudio {
      override play(): Promise<void> {
        this.playCalls++;
        return Promise.reject(new Error("blocked"));
      }
    }
    vi.stubGlobal("Audio", RejectingAudio);
    setSoundEnabled(true);
    expect(() => playSound(SoundEffect.MoveToTrash)).not.toThrow();
    expect(RejectingAudio.instances).toHaveLength(1);
    expect(RejectingAudio.instances[0].playCalls).toBe(1);
  });

  it("is a no-op when Audio is undefined (SSR/non-DOM)", () => {
    setSoundEnabled(true);
    expect(() => playSound(SoundEffect.EmptyTrash)).not.toThrow();
  });
});
