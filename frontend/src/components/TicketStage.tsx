import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { PaperRim } from "./PaperRim";
import "./ticket-motion.css";

type TicketIdentity = { id: string; title: string };
type Pose = {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  lift: number;
  zoom: number;
};
type Rect = { x: number; y: number; width: number; height: number };
type LayoutSnapshot = {
  cards: { rect: Rect; rotation: string }[];
};
type Gesture = {
  id: number;
  x: number;
  y: number;
  lastX: number;
  time: number;
  vx: number;
  dx: number;
  dy: number;
  moved: boolean;
};
const rest = (): Pose => ({
  x: 0,
  y: 0,
  z: 0,
  rx: 0,
  ry: 0,
  rz: 0,
  lift: 0,
  zoom: 0,
});
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const FACE_WIDTH = 440;
const power2Out = (t: number) => 1 - (1 - t) ** 3;
const power2InOut = (t: number) =>
  t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
const power1InOut = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
function sizePaper(card: HTMLElement, width: number) {
  card.style.setProperty("--paper-thickness", `${width * 0.01}px`);
  card.style.setProperty("--face-scale", `${width / FACE_WIDTH}`);
  // Reference camera distance/card width = 10/5. Keep the same projection
  // on smaller cards instead of using one fixed, nearly orthographic lens.
  card.parentElement?.style.setProperty("--card-perspective", `${width * 2}px`);
}
const poseTransform = (p: Pose) =>
  `translate3d(${p.x}px,${p.y}px,${p.z}px) rotateX(${p.rx}deg) rotateY(${p.ry}deg) rotateZ(${p.rz}deg) scale(${1 + p.zoom})`;
function dragPose(side: number, width: number): Pose {
  // Port of the reference's getDragTimeline: x ±3.1, z 1.5, y-rotation
  // ±0.66 rad, scale .9, for a 5-unit-wide card. CSS reverses the Z axis
  // rotation sign because its screen Y axis points down.
  const amount = Math.abs(side);
  return {
    x: side * width * (3.1 / 5),
    y: 0,
    z: amount * width * (1.5 / 5),
    rx: 0,
    ry: side * 0.66 * (180 / Math.PI),
    rz: side * 0.12 * (180 / Math.PI),
    lift: amount,
    zoom: -0.1 * amount,
  };
}
const rectOf = (el: HTMLElement): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
};

export function TicketStage<T extends TicketIdentity>({
  tickets,
  front,
  back,
  onOpen,
}: {
  tickets: T[];
  front: (ticket: T) => ReactNode;
  back: (ticket: T, close: () => void) => ReactNode;
  onOpen?: (ticket: T) => void;
}) {
  const [view, setView] = useState<"stack" | "grid">("stack");
  const [active, setActive] = useState(0);
  const [phase, setPhase] = useState<
    "browse" | "opening" | "detail" | "closing"
  >("browse");
  const [busy, setBusy] = useState(false);
  const [layoutMoving, setLayoutMoving] = useState(false);
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const slots = useRef<(HTMLDivElement | null)[]>([]);
  const rests = useRef<(HTMLDivElement | null)[]>([]);
  const collection = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const shadows = useRef<(HTMLDivElement | null)[]>([]);
  const lights = useRef<(HTMLSpanElement | null)[]>([]);
  const detail = useRef<HTMLElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const ghostBody = useRef<HTMLDivElement>(null);
  const ghostShadow = useRef<HTMLDivElement>(null);
  const ghostBack = useRef<HTMLDivElement>(null);
  const ghostLight = useRef<HTMLSpanElement>(null);
  const frame = useRef(0);
  const flightFrame = useRef(0);
  const pose = useRef(rest());
  const target = useRef(rest());
  const velocity = useRef(rest());
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const locked = useRef(false);
  const layoutPlan = useRef<LayoutSnapshot | null>(null);
  const recycledIndex = useRef<number | null>(null);
  const recycleAnimation = useRef<Animation | null>(null);
  const browseScroll = useRef(0);
  const frontRect = useRef<Rect | null>(null);
  const backRect = useRef<Rect | null>(null);
  const startPose = useRef(rest());
  const animations = useRef<Animation[]>([]);
  const layoutFocus = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  const current = tickets[active];
  const isDetail = phase === "opening" || phase === "detail";
  const isFlight = phase === "opening" || phase === "closing";

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    // Match the reference geometry's thickness/width ratio (0.05 / 5),
    // including grid cards and viewport changes.
    const observer = new ResizeObserver((entries) => {
      entries.forEach(({ target: element, contentRect }) => {
        sizePaper(element as HTMLElement, contentRect.width);
      });
    });
    cards.current.forEach((card) => {
      if (card) {
        sizePaper(card, card.offsetWidth);
        observer.observe(card);
      }
    });
    return () => observer.disconnect();
  }, []);

  function paint(p: Pose) {
    const card = cards.current[active];
    const shadow = shadows.current[active];
    const light = lights.current[active];
    if (card) card.style.transform = poseTransform(p);
    // The cast shadow stays on the table; it doesn't rotate with the paper.
    if (shadow) {
      // Project onto the stack using the reference's moving light (x ±14.41,
      // z 15). Raising the card also separates and softens its cast shadow.
      const lightX = clamp(p.ry / ((0.66 * 180) / Math.PI), -1, 1) * 14.41;
      shadow.style.transform = `translate3d(${p.x - (p.z * lightX) / 15}px,${p.y + 16 + p.z * 0.35}px,0) rotate(${p.rz}deg) scale(${(1 + p.zoom) * Math.cos((p.ry * Math.PI) / 180)},${1 + p.zoom})`;
      shadow.style.opacity = `${0.27 - p.lift * 0.1}`;
      shadow.style.filter = `blur(${12 + p.lift * 19}px)`;
    }
    if (light) {
      light.style.opacity = `${Math.min(0.13, (Math.abs(p.ry) + Math.abs(p.rx)) / 300)}`;
      light.style.transform = p.ry < 0 ? "scaleX(-1)" : "none";
    }
  }

  function stopSpring() {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
  }

  function aim(next: Pose) {
    if (reduced) return;
    target.current = next;
    if (frame.current) return;
    let previous = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - previous) / 1000, 0.032);
      previous = now;
      let energy = 0;
      // All channels follow the same progress, like the reference timeline.
      // Different translation/rotation springs made the card slide first and
      // rotate later, breaking the perception of one continuous 3D arc.
      for (const key of Object.keys(next) as (keyof Pose)[]) {
        const stiffness = gesture.current ? 620 : 110;
        const damping = gesture.current ? 50 : 21;
        velocity.current[key] +=
          ((target.current[key] - pose.current[key]) * stiffness -
            velocity.current[key] * damping) *
          dt;
        pose.current[key] += velocity.current[key] * dt;
        energy +=
          Math.abs(target.current[key] - pose.current[key]) +
          Math.abs(velocity.current[key]);
      }
      paint(pose.current);
      if (energy > 0.025) frame.current = requestAnimationFrame(tick);
      else {
        pose.current = { ...target.current };
        paint(pose.current);
        frame.current = 0;
      }
    };
    frame.current = requestAnimationFrame(tick);
  }

  function resetPose() {
    stopSpring();
    pose.current = rest();
    target.current = rest();
    velocity.current = rest();
    clearPoseStyles(active);
  }

  function clearPoseStyles(index: number) {
    cards.current[index]?.style.removeProperty("transform");
    for (const property of ["transform", "opacity", "filter"])
      shadows.current[index]?.style.removeProperty(property);
    lights.current[index]?.style.removeProperty("opacity");
    lights.current[index]?.style.removeProperty("transform");
  }

  useLayoutEffect(() => {
    const recycled = recycledIndex.current;
    if (recycled === null) return;
    recycledIndex.current = null;
    // React has now committed the new stacking order. Only here is it safe to
    // bring the offscreen card back; resetting it before the commit flashes it
    // over the entire pile for a frame, with the old active-card shadow attached.
    clearPoseStyles(recycled);
    pose.current = rest();
    target.current = rest();
    velocity.current = rest();
    const slot = slots.current[recycled]!;
    recycleAnimation.current?.cancel();
    recycleAnimation.current = slot.animate(
      [{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }],
      { duration: 360, easing: "ease-out" },
    );
    slot.style.removeProperty("visibility");
    locked.current = false;
    setBusy(false);
  }, [active]);

  function nextTicket(direction = -1, releaseVelocity = 0, instant = false) {
    if (locked.current || phase !== "browse" || view !== "stack") return;
    if (reduced || instant) {
      resetPose();
      setActive((active + 1) % tickets.length);
      return;
    }
    locked.current = true;
    setBusy(true);
    stopSpring();
    const start = { ...pose.current };
    const width = cards.current[active]?.offsetWidth ?? 350;
    const distance = window.innerWidth / 2 + width * 1.35;
    const duration = clamp(610 - Math.abs(releaseVelocity) * 85, 360, 610);
    const startTime = performance.now();
    const tick = (now: number) => {
      const t = clamp((now - startTime) / duration, 0, 1);
      // Continue the actual release pose and accelerate into an offscreen arc.
      const travel = 0.38 * t + 0.62 * t * t;
      const p = {
        x: start.x + direction * distance * travel,
        y:
          start.y - Math.sin(t * Math.PI) * width * 0.13 + t * t * width * 0.22,
        z: start.z + Math.sin(t * Math.PI) * 95,
        rx: mix(start.rx, -12, t),
        ry: mix(start.ry, direction * 48, t),
        rz: start.rz + direction * (16 + Math.abs(start.rz) * 0.35) * t,
        lift: mix(start.lift, 1, Math.min(1, t * 3)),
        zoom: mix(start.zoom, -0.1, t),
      };
      pose.current = p;
      paint(p);
      if (t < 1) flightFrame.current = requestAnimationFrame(tick);
      else {
        // Keep the outgoing sheet offscreen until its new depth is committed.
        slots.current[active]!.style.visibility = "hidden";
        recycledIndex.current = active;
        setActive((active + 1) % tickets.length);
      }
    };
    flightFrame.current = requestAnimationFrame(tick);
  }

  function pointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (
      view !== "stack" ||
      locked.current ||
      !e.isPrimary ||
      e.button !== 0 ||
      gesture.current
    )
      return;
    gesture.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      time: performance.now(),
      vx: 0,
      dx: 0,
      dy: 0,
      moved: false,
    };
    suppressClick.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.dataset.dragging = "true";
  }

  function pointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    if (locked.current || view !== "stack") return;
    const g = gesture.current;
    if (g && g.id === e.pointerId) {
      const now = performance.now();
      const dt = Math.max(8, now - g.time);
      g.dx = e.clientX - g.x;
      g.dy = e.clientY - g.y;
      g.vx = mix(g.vx, (e.clientX - g.lastX) / dt, 0.65);
      g.lastX = e.clientX;
      g.time = now;
      g.moved ||= Math.hypot(g.dx, g.dy) > 7;
      const width = e.currentTarget.offsetWidth;
      const dragWidth = collection.current?.clientWidth ?? window.innerWidth;
      aim(dragPose(clamp((3 * g.dx) / dragWidth, -1, 1), width));
    }
  }

  function pointerUp(
    e: ReactPointerEvent<HTMLButtonElement>,
    cancelled = false,
  ) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    delete e.currentTarget.dataset.dragging;
    suppressClick.current = g.moved;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    const vx = performance.now() - g.time < 100 ? g.vx : 0;
    if (
      !cancelled &&
      (Math.abs(g.dx) > e.currentTarget.offsetWidth * 0.24 ||
        (Math.abs(vx) > 0.55 && Math.abs(g.dx) > 18))
    ) {
      nextTicket(Math.sign(Math.abs(vx) > 0.55 ? vx : g.dx), vx);
    } else aim(rest());
  }

  function openTicket(index = active) {
    if (locked.current || phase !== "browse" || gesture.current) return;
    onOpen?.(tickets[index]);
    frontRect.current = rectOf(slots.current[index]!);
    startPose.current =
      index === active && view === "stack" ? { ...pose.current } : rest();
    browseScroll.current = window.scrollY;
    stopSpring();
    locked.current = !reduced;
    setActive(index);
    setPhase(reduced ? "detail" : "opening");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function closeTicket() {
    if (phase !== "detail") return;
    // Return from the top of the long ticket, including Escape while scrolled.
    window.scrollTo({ top: 0, behavior: "instant" });
    backRect.current = rectOf(detail.current!);
    locked.current = !reduced;
    restoreFocus.current = true;
    resetPose();
    setPhase(reduced ? "browse" : "closing");
  }

  function changeView(next: "stack" | "grid") {
    if (view === next || locked.current || gesture.current) return;
    resetPose();
    layoutFocus.current =
      document.activeElement instanceof HTMLElement &&
      document.activeElement.closest(".view-switch")
        ? document.activeElement
        : null;
    const snapshot: LayoutSnapshot = {
      cards: slots.current.map((el, index) => ({
        rect: rectOf(el!),
        rotation: getComputedStyle(rests.current[index]!).transform,
      })),
    };
    layoutPlan.current = snapshot;
    animations.current.forEach((a) => a.cancel());
    recycleAnimation.current?.cancel();
    locked.current = !reduced;
    setBusy(!reduced);
    setLayoutMoving(!reduced);
    setView(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  useLayoutEffect(() => {
    if (!layoutPlan.current) return;
    const before = layoutPlan.current;
    layoutPlan.current = null;
    slots.current.forEach((slot, index) =>
      sizePaper(cards.current[index]!, slot!.getBoundingClientRect().width),
    );
    if (reduced) {
      locked.current = false;
      return;
    }
    const expanding = view === "grid";
    // Reference getToGridTimeline: 2.1s forward with power2.out on timeline
    // progress; 1.3s backwards with power1.inOut. Position spreads at 1.1s,
    // rotation straightens over the first 1.5s. All cards share the same clock.
    const duration = expanding ? 2100 : 1300;
    animations.current = [];
    slots.current.forEach((el, index) => {
      const after = rectOf(el!);
      const old = before.cards[index].rect;
      const stack = expanding ? old : after;
      const grid = expanding ? after : old;
      const resting = rests.current[index]!;
      const startRotation = new DOMMatrix(before.cards[index].rotation);
      const endRotation = new DOMMatrix(
        resting.style.transform === "none"
          ? undefined
          : resting.style.transform,
      );
      const fromMatrix = Array.from(startRotation.toFloat64Array());
      const toMatrix = Array.from(endRotation.toFloat64Array());
      const positions: Keyframe[] = [];
      const rotations: Keyframe[] = [];
      for (let frame = 0; frame <= 72; frame++) {
        const time = frame / 72;
        const clock =
          2.1 * (expanding ? power2Out(time) : 1 - power1InOut(time));
        const spread = power2InOut(clamp(clock - 1.1, 0, 1));
        const straighten = power2Out(clamp(clock / 1.5, 0, 1));
        const rotationProgress = expanding ? straighten : 1 - straighten;
        positions.push({
          offset: time,
          transform: `translate(${mix(stack.x, grid.x, spread) - after.x}px,${mix(stack.y, grid.y, spread) - after.y}px) scale(${mix(stack.width, grid.width, spread) / after.width},${mix(stack.height, grid.height, spread) / after.height})`,
        });
        rotations.push({
          offset: time,
          transform: `matrix3d(${fromMatrix.map((value, j) => mix(value, toMatrix[j], rotationProgress)).join(",")})`,
        });
      }
      animations.current.push(
        el!.animate(positions, { duration, fill: "both", easing: "linear" }),
        resting.animate(rotations, {
          duration,
          fill: "both",
          easing: "linear",
        }),
      );
    });
    const labels = collection.current!.querySelectorAll<HTMLElement>(
      expanding ? ".grid-intro" : ".stage-action",
    );
    labels.forEach((label) =>
      animations.current.push(
        label.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 180,
          delay: duration * 0.65,
          fill: "both",
        }),
      ),
    );
    const finish = () => {
      setLayoutMoving(false);
      setBusy(false);
      window.removeEventListener("resize", finish);
    };
    window.addEventListener("resize", finish, { once: true });
    Promise.all(animations.current.map((a) => a.finished))
      .then(finish)
      .catch(() => {});
    return () => window.removeEventListener("resize", finish);
  }, [view, reduced]);

  useLayoutEffect(() => {
    if (layoutMoving) return;
    animations.current.forEach((a) => a.cancel());
    animations.current = [];
    locked.current = false;
    layoutFocus.current?.focus({ preventScroll: true });
    layoutFocus.current = null;
  }, [layoutMoving]);

  useLayoutEffect(() => {
    if (!isFlight) {
      if (phase === "detail")
        detail.current
          ?.querySelector<HTMLButtonElement>(".close-ticket")
          ?.focus({ preventScroll: true });
      if (phase === "browse") {
        window.scrollTo({ top: browseScroll.current, behavior: "instant" });
        if (restoreFocus.current) {
          restoreFocus.current = false;
          cards.current[active]?.focus({ preventScroll: true });
        }
      }
      return;
    }
    const opening = phase === "opening";
    if (opening) backRect.current = rectOf(detail.current!);
    else {
      window.scrollTo({ top: browseScroll.current, behavior: "instant" });
      frontRect.current = rectOf(slots.current[active]!);
      startPose.current = rest();
    }
    const a = frontRect.current!;
    const b = backRect.current!;
    const scale = b.width / a.width;
    const shell = ghost.current!;
    const body = ghostBody.current!;
    sizePaper(body, a.width);
    const cast = ghostShadow.current!;
    shell.style.width = `${a.width}px`;
    ghostBack.current!.style.width = `${b.width}px`;
    ghostBack.current!.style.transform = `scale(${1 / scale})`;
    const start = performance.now();
    const duration = reduced ? 1 : opening ? 820 : 680;
    const tick = (now: number) => {
      const time = clamp((now - start) / duration, 0, 1);
      const p = opening ? smooth(time) : 1 - smooth(time);
      const lift = Math.sin(p * Math.PI);
      const initial = startPose.current;
      const s = mix(1, scale, p);
      // Both faces share one changing outline; the long back unfolds only after
      // the front has passed edge-on. Closing uses this exact trajectory in reverse.
      const unfold = smooth(clamp((p - 0.5) / 0.5, 0, 1));
      shell.style.height = `${mix(a.height, b.height / scale, unfold)}px`;
      shell.style.transform = `translate3d(${mix(a.x + initial.x, b.x, p) + lift * a.width * 0.65}px,${mix(a.y + initial.y, b.y, p)}px,0) scale(${s})`;
      body.style.transform = `translateZ(${lift * a.width * 0.3 + initial.z * (1 - p)}px) rotateX(${initial.rx * (1 - p)}deg) rotateY(${mix(initial.ry, 180, p)}deg) rotateZ(${initial.rz * (1 - p)}deg) scale(${1 + initial.zoom * (1 - p)})`;
      cast.style.transform = `translate(${lift * 24}px,${18 + lift * 35}px) scaleX(${1 - lift * 0.62})`;
      cast.style.opacity = `${0.2 - lift * 0.07}`;
      cast.style.filter = `blur(${14 + lift * 20}px)`;
      ghostLight.current!.style.opacity = `${lift * 0.18}`;
      if (time < 1) flightFrame.current = requestAnimationFrame(tick);
      else {
        locked.current = false;
        resetPose();
        setPhase(opening ? "detail" : "browse");
      }
    };
    tick(start);
    return () => cancelAnimationFrame(flightFrame.current);
  }, [phase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (gesture.current) {
          const card = cards.current[active];
          const pointerId = gesture.current.id;
          gesture.current = null;
          suppressClick.current = true;
          if (card) {
            delete card.dataset.dragging;
            if (card.hasPointerCapture(pointerId))
              card.releasePointerCapture(pointerId);
          }
          aim(rest());
        } else closeTicket();
      }
      if (e.key === "ArrowRight" && phase === "browse" && view === "stack") {
        e.preventDefault();
        nextTicket(-1, 0, true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      cancelAnimationFrame(flightFrame.current);
      animations.current.forEach((a) => a.cancel());
      recycleAnimation.current?.cancel();
    },
    [],
  );

  return (
    <section
      className={`ticket-stage motion-stage ${isDetail ? "stage-detail" : view === "grid" ? "stage-grid" : ""}`}
      aria-label="我的门票"
      data-phase={phase}
      data-layout-transition={layoutMoving ? "true" : undefined}
    >
      <div
        className="collection-layout"
        ref={collection}
        data-view={view}
        hidden={isDetail}
        inert={isFlight || busy}
      >
        <div className="grid-intro" hidden={view !== "grid"}>
          <h1>My tickets</h1>
          <p>Four things worth keeping close.</p>
        </div>
        <button
          className="stage-action action-next"
          hidden={view !== "stack"}
          onClick={() => nextTicket()}
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse" && !locked.current)
              aim(
                dragPose(-1, cards.current[active]?.offsetWidth ?? FACE_WIDTH),
              );
          }}
          onPointerLeave={() => {
            if (!locked.current) aim(rest());
          }}
        >
          <span>Next ticket</span>
        </button>
        <div className="ticket-collection" data-view={view}>
          {tickets.map((ticket, index) => {
            const depth = (index - active + tickets.length) % tickets.length;
            const isTop = depth === 0;
            const hidden = view === "stack" && !isTop;
            return (
              <div
                key={ticket.id}
                ref={(el) => {
                  slots.current[index] = el;
                }}
                className="deck-item"
                data-depth={depth}
                style={{
                  zIndex: tickets.length - depth,
                  visibility:
                    isFlight && index === active ? "hidden" : undefined,
                }}
              >
                <div
                  className="deck-rest"
                  ref={(el) => {
                    rests.current[index] = el;
                  }}
                  style={{
                    transform:
                      view === "stack"
                        ? `translate(${[0, 7, -8, 3][depth] ?? 0}px,${depth * 2}px) rotate(${[0, 3.5, -3.8, 1.5][depth] ?? 0}deg)`
                        : "none",
                  }}
                >
                  <div
                    className="ticket-cast-shadow"
                    ref={(el) => {
                      shadows.current[index] = el;
                    }}
                    aria-hidden="true"
                  />
                  <button
                    ref={(el) => {
                      cards.current[index] = el;
                    }}
                    className={`ticket-front deck-card ${view === "grid" ? "grid-ticket" : ""}`}
                    aria-label={`查看门票：${ticket.title}`}
                    aria-hidden={hidden || undefined}
                    tabIndex={hidden ? -1 : 0}
                    inert={hidden}
                    onPointerDown={pointerDown}
                    onPointerMove={pointerMove}
                    onPointerUp={(e) => pointerUp(e)}
                    onPointerCancel={(e) => pointerUp(e, true)}
                    onLostPointerCapture={(e) => pointerUp(e, true)}
                    onPointerLeave={() => {
                      if (!gesture.current && !locked.current && isTop)
                        aim(rest());
                    }}
                    onClick={() => {
                      if (suppressClick.current) {
                        suppressClick.current = false;
                        return;
                      }
                      openTicket(index);
                    }}
                  >
                    <span className="paper-back" aria-hidden="true" />
                    <PaperRim />
                    <div className="paper-face">
                      <div className="ticket-artwork">{front(ticket)}</div>
                      <span
                        className="ticket-light"
                        ref={(el) => {
                          lights.current[index] = el;
                        }}
                        aria-hidden="true"
                      />
                    </div>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button
          className="stage-action action-show"
          hidden={view !== "stack"}
          onClick={() => openTicket()}
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse" && !locked.current)
              aim(
                dragPose(1, cards.current[active]?.offsetWidth ?? FACE_WIDTH),
              );
          }}
          onPointerLeave={() => {
            if (!locked.current) aim(rest());
          }}
        >
          <span>Show me!</span>
        </button>
      </div>
      {isDetail && (
        <div
          className="detail-layout"
          style={{ visibility: phase === "opening" ? "hidden" : undefined }}
        >
          <div className="detail-guide">
            我的门票{" "}
            <span>
              / {String(active + 1).padStart(2, "0")} —{" "}
              {String(tickets.length).padStart(2, "0")}
            </span>
          </div>
          <div className="ticket-detail-wrap">
            <article className="ticket-detail motion-detail" ref={detail}>
              {back(current, closeTicket)}
            </article>
          </div>
        </div>
      )}
      {isFlight && (
        <div className="ticket-flight-layer" aria-hidden="true" inert>
          <div className="ticket-flight" ref={ghost}>
            <div className="flight-shadow" ref={ghostShadow} />
            <div className="flight-body" ref={ghostBody}>
              <PaperRim />
              <div
                className={`flight-face flight-front ticket-front ${view === "grid" ? "grid-ticket" : ""}`}
              >
                <div className="ticket-artwork">{front(current)}</div>
              </div>
              <div className="flight-face flight-back">
                <div ref={ghostBack}>{back(current, () => {})}</div>
                <span className="flight-light" ref={ghostLight} />
              </div>
            </div>
          </div>
        </div>
      )}
      {!isDetail && (
        <>
          <div
            className={`view-switch ${view === "grid" ? "switch-grid" : ""}`}
            role="group"
            aria-label="门票排列方式"
            inert={isFlight || busy}
          >
            <button
              className={view === "stack" ? "selected" : ""}
              onClick={() => changeView("stack")}
              aria-label="堆叠视图"
              aria-pressed={view === "stack"}
            >
              <span className="stack-icon" />
            </button>
            <button
              className={view === "grid" ? "selected" : ""}
              onClick={() => changeView("grid")}
              aria-label="平铺视图"
              aria-pressed={view === "grid"}
            >
              <svg
                width="19"
                height="19"
                viewBox="0 0 19 19"
                fill="currentColor"
                aria-hidden="true"
              >
                <circle cx="5" cy="5" r="2.4" />
                <circle cx="14" cy="5" r="2.4" />
                <circle cx="5" cy="14" r="2.4" />
                <circle cx="14" cy="14" r="2.4" />
              </svg>
            </button>
          </div>
          <div className="stage-footer">
            <span>FAIRPASS / CAMPUS EXPERIENCES</span>
            <span aria-live="polite">
              {String(active + 1).padStart(2, "0")} /{" "}
              {String(tickets.length).padStart(2, "0")}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
