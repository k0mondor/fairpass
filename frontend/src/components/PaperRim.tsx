import type { CSSProperties } from "react";

// A rounded sheet extruded behind its front face. The walls live in 3D space,
// so a change in yaw exposes the opposite edge instead of offsetting a shadow.
const corners = [
  { x: "var(--paper-radius)", y: "var(--paper-radius)", start: 180 },
  { x: "100% - var(--paper-radius)", y: "var(--paper-radius)", start: 270 },
  {
    x: "100% - var(--paper-radius)",
    y: "100% - var(--paper-radius)",
    start: 0,
  },
  { x: "var(--paper-radius)", y: "100% - var(--paper-radius)", start: 90 },
];
const segments = 8;
const step = 90 / segments;
const chord = 2 * Math.sin((step * Math.PI) / 360);

export function PaperRim() {
  return (
    <>
      <span className="paper-wall paper-wall-top" aria-hidden="true" />
      <span className="paper-wall paper-wall-bottom" aria-hidden="true" />
      <span className="paper-wall paper-wall-left" aria-hidden="true" />
      <span className="paper-wall paper-wall-right" aria-hidden="true" />
      {corners.flatMap((corner, c) =>
        Array.from({ length: segments }, (_, i) => {
          const angle = corner.start + i * step;
          const radians = (angle * Math.PI) / 180;
          const light =
            79 + 8 * Math.cos(((angle + step / 2 + 125) * Math.PI) / 180);
          const style: CSSProperties = {
            left: `calc(${corner.x} + var(--paper-radius) * ${Math.cos(radians)})`,
            top: `calc(${corner.y} + var(--paper-radius) * ${Math.sin(radians)})`,
            width: `calc(var(--paper-radius) * ${chord} + 0.15px)`,
            transform: `rotateZ(${angle + step / 2 + 90}deg) rotateX(-90deg)`,
            backgroundColor: `hsl(39 18% ${light}%)`,
          };
          return (
            <span
              key={`${c}-${i}`}
              className="paper-wall paper-wall-corner"
              style={style}
              aria-hidden="true"
            />
          );
        }),
      )}
    </>
  );
}
