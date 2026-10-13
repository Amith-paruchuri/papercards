"use client";
import { useRef } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from "motion/react";

/** The sign-in story, played once: a sentence in a PDF gets highlighted and lands as a bullet
 *  under "Introduction" in that paper's notes. Real UI pieces, no loops, still under reduced motion. */
export function AuthStage() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 120, damping: 20 });
  const sy = useSpring(py, { stiffness: 120, damping: 20 });
  const rotY = useTransform(sx, [-1, 1], [-5, 5]);
  const rotX = useTransform(sy, [-1, 1], [4, -4]);

  function onMove(e: React.PointerEvent) {
    if (reduce || e.pointerType !== "mouse") return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    px.set(((e.clientX - r.left) / r.width) * 2 - 1);
    py.set(((e.clientY - r.top) / r.height) * 2 - 1);
  }
  function onLeave() {
    px.set(0);
    py.set(0);
  }

  const t = (delay: number, extra: object = {}) => (reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 140, damping: 22, delay, ...extra });

  return (
    <div className="auth-stage" ref={ref} onPointerMove={onMove} onPointerLeave={onLeave} aria-hidden="true">
      <motion.div className="stage-tilt" style={{ rotateX: rotX, rotateY: rotY }}>
        {/* back cards, fanned */}
        <Layer depth={0.4} x={sx} y={sy} className="stage-back b1">
          <motion.div className="mini-card" data-status="to_read" initial={reduce ? false : { opacity: 0, y: 40, rotate: 0 }} animate={{ opacity: 1, y: 0, rotate: -7 }} transition={t(0.15)}>
            <div className="mc-title">Attention is all you need</div>
            <div className="mc-by">
              Vaswani et al., 2017. <em>NeurIPS</em>
            </div>
            <div className="mc-strip">
              <i /><i /><i /><i />
            </div>
          </motion.div>
        </Layer>
        <Layer depth={0.55} x={sx} y={sy} className="stage-back b2">
          <motion.div className="mini-card" data-status="read" initial={reduce ? false : { opacity: 0, y: 40, rotate: 0 }} animate={{ opacity: 1, y: 0, rotate: 5 }} transition={t(0.25)}>
            <div className="mc-title">Highly accurate protein structure prediction with AlphaFold</div>
            <div className="mc-by">
              Jumper et al., 2021. <em>Nature</em>
            </div>
            <div className="mc-strip">
              <i className="on" style={{ "--sec": "#5ec4ee" } as React.CSSProperties} />
              <i className="on" style={{ "--sec": "#7ed67e" } as React.CSSProperties} />
              <i />
              <i />
            </div>
          </motion.div>
        </Layer>

        {/* the PDF page */}
        <Layer depth={0.8} x={sx} y={sy} className="stage-sheet-wrap">
          <motion.div className="stage-sheet" initial={reduce ? false : { opacity: 0, y: 30, rotate: -1 }} animate={{ opacity: 1, y: 0, rotate: -2.5 }} transition={t(0.35)}>
            <div className="sh-kicker">1 &nbsp;Introduction</div>
            <p>
              Deep learning has changed how slides are read, but most systems are trained on small, carefully outlined datasets.{" "}
              <motion.span
                className="sh-hl"
                initial={reduce ? false : { backgroundSize: "0% 100%" }}
                animate={{ backgroundSize: "100% 100%" }}
                transition={reduce ? { duration: 0 } : { delay: 1.15, duration: 0.75, ease: [0.3, 0.7, 0.2, 1] }}
              >
                Manual pixel-level annotation does not scale to clinical slide volumes.
              </motion.span>{" "}
              We instead train on the diagnosis already written in each pathology report.
            </p>
            <div className="sh-lines">
              <i style={{ width: "96%" }} />
              <i style={{ width: "88%" }} />
              <i style={{ width: "93%" }} />
              <i style={{ width: "61%" }} />
            </div>
          </motion.div>
        </Layer>

        {/* the paper's card with its notes */}
        <Layer depth={1.25} x={sx} y={sy} className="stage-note-wrap">
          <motion.div className="stage-note" initial={reduce ? false : { opacity: 0, x: 40, rotate: 4 }} animate={{ opacity: 1, x: 0, rotate: 1.5 }} transition={t(0.55)}>
            <div className="sn-title">Clinical-grade computational pathology using weakly supervised deep learning</div>
            <div className="sn-by">
              Campanella et al., 2019. <em>Nature Medicine</em>
            </div>
            <div className="sn-section">
              <div className="sn-head">Introduction</div>
              <motion.div
                className="sn-bullet"
                initial={reduce ? false : { opacity: 0, y: -6, backgroundColor: "rgba(94, 196, 238, 0.45)" }}
                animate={{ opacity: 1, y: 0, backgroundColor: "rgba(94, 196, 238, 0)" }}
                transition={reduce ? { duration: 0 } : { delay: 2.0, duration: 1.4, ease: "easeOut" }}
              >
                Manual pixel-level annotation does not scale to clinical slide volumes.
                <span className="sn-pg">p. 1</span>
              </motion.div>
            </div>
            <div className="mc-strip">
              <motion.i
                style={{ "--sec": "#5ec4ee" } as React.CSSProperties}
                initial={reduce ? false : { scaleX: 0.0001 }}
                animate={{ scaleX: 1 }}
                transition={reduce ? { duration: 0 } : { delay: 2.15, duration: 0.5, ease: "easeOut" }}
                className="on grow"
              />
              <i />
              <i />
              <i />
            </div>
          </motion.div>
        </Layer>
      </motion.div>
    </div>
  );
}

function Layer({ depth, x, y, className, children }: { depth: number; x: MotionValue<number>; y: MotionValue<number>; className: string; children: React.ReactNode }) {
  const tx = useTransform(x, [-1, 1], [-10 * depth, 10 * depth]);
  const ty = useTransform(y, [-1, 1], [-8 * depth, 8 * depth]);
  return (
    <motion.div className={className} style={{ x: tx, y: ty }}>
      {children}
    </motion.div>
  );
}
