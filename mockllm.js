// mockLLM.js

function mockDecide(cars) {
  return cars.map(car => {
    const { id, speed, front, signal } = car;

    // 1. SIGNAL IS NULL: Past stop line, ignore lights and clear intersection
    if (signal === null) {
      if (front !== null && front.dist < 35) {
        return { id, action: "BRAKE", intensity: 0.6 };
      }
      return { id, action: "ACCELERATE", throttle: 0.8 };
    }

    // 2. RED LIGHT LOGIC
    if (signal.state === "RED") {
      if (signal.distToStop <= 40) {
        return { id, action: "BRAKE", intensity: 1.0 };
      } else if (signal.distToStop <= 150) {
        return { id, action: "BRAKE", intensity: 0.7 };
      }
    }

    // 3. YELLOW LIGHT LOGIC
    // Stop if speed² / (2 * max_braking) < distToStop, otherwise continue
    if (signal.state === "YELLOW") {
      const stoppingDist = (speed * speed) / (2 * 150);
      if (stoppingDist < signal.distToStop) {
        return { id, action: "BRAKE", intensity: 0.8 };
      } else {
        // Continue through intersection if stopping distance is greater than distance to stop line
        return { id, action: "ACCELERATE", throttle: 0.6 };
      }
    }

    // 4. FRONT OBSTACLE & SAFE GAP LOGIC (Time-to-collision / closing speed)
    if (front !== null) {
      // If closing speed (dv is negative) is high or gap is too small
      if (front.dist < 45 || (front.dv < -5 && front.dist < 80)) {
        return { id, action: "BRAKE", intensity: 0.5 };
      } else if (front.dist > 90 && speed < 120) {
        return { id, action: "ACCELERATE", throttle: 0.8 };
      } else {
        return { id, action: "MAINTAIN" };
      }
    }

    // 5. FREE ROAD / GREEN LIGHT
    if (signal.state === "GREEN" && speed < 120) {
      return { id, action: "ACCELERATE", throttle: 1.0 };
    }

    return { id, action: "MAINTAIN" };
  });
}

module.exports = { mockDecide };