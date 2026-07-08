import React, { useRef } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { cn } from "../../../lib/cn";

export function TiltedCard({
  children,
  className = "",
  rotateMax = 10,
  glareColor = "rgba(255, 255, 255, 0.05)",
  ...props
}) {
  const containerRef = useRef(null);

  const x = useMotionValue(0.5);
  const y = useMotionValue(0.5);

  const xSpring = useSpring(x, { stiffness: 220, damping: 22 });
  const ySpring = useSpring(y, { stiffness: 220, damping: 22 });

  // Map coordinate range [0, 1] to rotate angle range [rotateMax, -rotateMax]
  const rotateX = useTransform(ySpring, [0, 1], [rotateMax, -rotateMax]);
  const rotateY = useTransform(xSpring, [0, 1], [-rotateMax, rotateMax]);

  // Dynamic glare gradients depending on pointer coordinates
  const glareOpacity = useTransform(xSpring, [0, 0.5, 1], [0.4, 0, 0.4]);
  const glareX = useTransform(xSpring, [0, 1], ["0%", "100%"]);
  const glareY = useTransform(ySpring, [0, 1], ["0%", "100%"]);

  const handlePointerMove = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    x.set(mouseX / width);
    y.set(mouseY / height);
  };

  const handlePointerLeave = () => {
    x.set(0.5);
    y.set(0.5);
  };

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className="w-full h-full select-none"
      style={{ perspective: "1000px" }}
      {...props}
    >
      <motion.div
        style={{
          rotateX,
          rotateY,
          transformStyle: "preserve-3d",
        }}
        className={cn(
          "relative w-full h-full rounded-2xl border border-oai-gray-800 bg-[#080808] p-6 shadow-2xl transition-all duration-200 ease-out",
          className
        )}
      >
        {/* Dynamic glare surface overlay */}
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-2xl z-20"
          style={{
            opacity: glareOpacity,
            background: `radial-gradient(circle at ${glareX} ${glareY}, ${glareColor}, transparent 65%)`,
          }}
        />

        {/* Inner container with 3D translation support */}
        <div
          className="relative z-10 w-full h-full"
          style={{
            transform: "translateZ(35px)",
            transformStyle: "preserve-3d",
          }}
        >
          {children}
        </div>
      </motion.div>
    </div>
  );
}

export default TiltedCard;
