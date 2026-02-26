/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Shield, Target, Trophy, AlertTriangle, RotateCcw, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Constants ---
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const CITY_COUNT = 6;
const TURRET_COUNT = 3;
const ENEMY_SPEED_MIN = 0.5;
const ENEMY_SPEED_MAX = 1.5;
const PLAYER_MISSILE_SPEED = 7;
const EXPLOSION_RADIUS_MAX = 80;
const EXPLOSION_DURATION = 60; // frames
const WIN_SCORE = 1000;

type Language = 'en' | 'zh';

interface Point {
  x: number;
  y: number;
}

interface Entity extends Point {
  id: string;
}

interface Rocket extends Entity {
  targetX: number;
  targetY: number;
  speed: number;
  progress: number; // 0 to 1
}

interface PlayerMissile extends Entity {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  progress: number;
}

interface Explosion extends Entity {
  radius: number;
  maxRadius: number;
  life: number; // frames remaining
}

interface City extends Entity {
  active: boolean;
}

interface Turret extends Entity {
  active: boolean;
  ammo: number;
  maxAmmo: number;
}

interface Star extends Point {
  size: number;
  opacity: number;
  twinkleSpeed: number;
  phase: number;
}

const TRANSLATIONS = {
  en: {
    title: "YIYI Interstellar Defense",
    score: "Score",
    ammo: "Ammo",
    win: "Mission Accomplished!",
    loss: "Defense Failed",
    restart: "Play Again",
    start: "Start Game",
    instructions: "Protect the cities! Click to fire interceptors.",
    targetReached: "Victory!",
    gameOver: "Game Over",
    wave: "Wave",
    waveCleared: "Wave Cleared!",
  },
  zh: {
    title: "YIYI星际防御",
    score: "得分",
    ammo: "弹药",
    win: "任务完成！",
    loss: "防御失败",
    restart: "再玩一次",
    start: "开始游戏",
    instructions: "保卫城市！点击发射拦截导弹。",
    targetReached: "胜利！",
    gameOver: "游戏结束",
    wave: "波次",
    waveCleared: "波次清除！",
  }
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<'start' | 'playing' | 'won' | 'lost'>('start');
  const [score, setScore] = useState(0);
  const [lang, setLang] = useState<Language>('zh');
  const [dimensions, setDimensions] = useState({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT });

  // Game Entities Refs (to avoid re-renders on every frame)
  const rocketsRef = useRef<Rocket[]>([]);
  const missilesRef = useRef<PlayerMissile[]>([]);
  const explosionsRef = useRef<Explosion[]>([]);
  const citiesRef = useRef<City[]>([]);
  const turretsRef = useRef<Turret[]>([]);
  const starsRef = useRef<Star[]>([]);
  const frameIdRef = useRef<number>(0);

  const t = TRANSLATIONS[lang];

  const [wave, setWave] = useState(1);
  const [isWaveTransition, setIsWaveTransition] = useState(false);
  const rocketsSpawnedInWave = useRef(0);
  const rocketsToSpawn = useRef(10);

  // Initialize Game Entities
  const initGame = useCallback(() => {
    const groundY = CANVAS_HEIGHT - 40;
    
    // Cities
    const cities: City[] = [];
    const citySpacing = CANVAS_WIDTH / (CITY_COUNT + TURRET_COUNT + 1);
    
    // Turrets
    const turrets: Turret[] = [
      { id: 't0', x: citySpacing, y: groundY, active: true, ammo: 20, maxAmmo: 20 },
      { id: 't1', x: CANVAS_WIDTH / 2, y: groundY, active: true, ammo: 40, maxAmmo: 40 },
      { id: 't2', x: CANVAS_WIDTH - citySpacing, y: groundY, active: true, ammo: 20, maxAmmo: 20 },
    ];

    const cityPositions = [
      citySpacing * 2, citySpacing * 3, citySpacing * 4,
      citySpacing * 6, citySpacing * 7, citySpacing * 8
    ];
    
    cityPositions.forEach((x, i) => {
      cities.push({ id: `c${i}`, x, y: groundY, active: true });
    });

    citiesRef.current = cities;
    turretsRef.current = turrets;
    rocketsRef.current = [];
    missilesRef.current = [];
    explosionsRef.current = [];
    
    // Initialize Stars
    const stars: Star[] = [];
    for (let i = 0; i < 150; i++) {
      stars.push({
        x: Math.random() * CANVAS_WIDTH,
        y: Math.random() * (CANVAS_HEIGHT - 40),
        size: Math.random() * 2,
        opacity: Math.random(),
        twinkleSpeed: 0.01 + Math.random() * 0.03,
        phase: Math.random() * Math.PI * 2
      });
    }
    starsRef.current = stars;

    rocketsSpawnedInWave.current = 0;
    rocketsToSpawn.current = 10;
    setScore(0);
    setWave(1);
    setIsWaveTransition(false);
  }, []);

  const startNextWave = useCallback(() => {
    // Calculate bonus points for remaining ammo
    let ammoBonus = 0;
    turretsRef.current.forEach(t => {
      if (t.active) {
        ammoBonus += t.ammo * 5;
        t.ammo = t.maxAmmo; // Refill
      }
    });
    
    setScore(s => s + ammoBonus);
    setWave(w => w + 1);
    rocketsSpawnedInWave.current = 0;
    rocketsToSpawn.current = 10 + wave * 5;
    setIsWaveTransition(false);
  }, [wave]);

  // Game State Refs for the loop
  const gameStateRef = useRef(gameState);
  const scoreRef = useRef(score);
  const waveRef = useRef(wave);
  const isWaveTransitionRef = useRef(isWaveTransition);

  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { scoreRef.current = score; }, [score]);
  useEffect(() => { waveRef.current = wave; }, [wave]);
  useEffect(() => { isWaveTransitionRef.current = isWaveTransition; }, [isWaveTransition]);

  // Game Loop
  const update = useCallback(() => {
    if (gameStateRef.current !== 'playing' || isWaveTransitionRef.current) return;

    // 1. Spawn Rockets
    if (rocketsSpawnedInWave.current < rocketsToSpawn.current) {
      if (Math.random() < 0.01 + (waveRef.current * 0.005)) {
        const startX = Math.random() * CANVAS_WIDTH;
        const targets = [...citiesRef.current.filter(c => c.active), ...turretsRef.current.filter(t => t.active)];
        if (targets.length > 0) {
          const target = targets[Math.floor(Math.random() * targets.length)];
          rocketsRef.current.push({
            id: Math.random().toString(36).substr(2, 9),
            x: startX,
            y: 0,
            targetX: target.x,
            targetY: target.y,
            speed: ENEMY_SPEED_MIN + Math.random() * (ENEMY_SPEED_MAX - ENEMY_SPEED_MIN) + (waveRef.current * 0.1),
            progress: 0
          });
          rocketsSpawnedInWave.current++;
        }
      }
    } else if (rocketsRef.current.length === 0 && !isWaveTransitionRef.current) {
      // Wave cleared!
      setIsWaveTransition(true);
      setTimeout(() => {
        if (gameStateRef.current === 'playing') startNextWave();
      }, 2000);
    }

    // 2. Update Rockets
    rocketsRef.current.forEach((rocket, index) => {
      const dist = Math.sqrt(Math.pow(rocket.targetX - rocket.x, 2) + Math.pow(rocket.targetY - rocket.y, 2));
      const dx = (rocket.targetX - rocket.x) / dist;
      const dy = (rocket.targetY - rocket.y) / dist;
      
      rocket.x += dx * rocket.speed;
      rocket.y += dy * rocket.speed;

      // Check if hit ground/target
      if (rocket.y >= rocket.targetY) {
        explosionsRef.current.push({
          id: `exp-impact-${rocket.id}`,
          x: rocket.x,
          y: rocket.y,
          radius: 0,
          maxRadius: 30,
          life: EXPLOSION_DURATION
        });

        citiesRef.current.forEach(c => {
          if (c.active && Math.abs(c.x - rocket.x) < 20) c.active = false;
        });
        turretsRef.current.forEach(t => {
          if (t.active && Math.abs(t.x - rocket.x) < 20) t.active = false;
        });

        rocketsRef.current.splice(index, 1);
      }
    });

    // 3. Update Player Missiles
    missilesRef.current.forEach((missile, index) => {
      const dist = Math.sqrt(Math.pow(missile.targetX - missile.startX, 2) + Math.pow(missile.targetY - missile.startY, 2));
      const totalFrames = dist / PLAYER_MISSILE_SPEED;
      missile.progress += 1 / totalFrames;

      missile.x = missile.startX + (missile.targetX - missile.startX) * missile.progress;
      missile.y = missile.startY + (missile.targetY - missile.startY) * missile.progress;

      if (missile.progress >= 1) {
        explosionsRef.current.push({
          id: `exp-player-${missile.id}`,
          x: missile.targetX,
          y: missile.targetY,
          radius: 0,
          maxRadius: EXPLOSION_RADIUS_MAX,
          life: EXPLOSION_DURATION
        });
        missilesRef.current.splice(index, 1);
      }
    });

    // 4. Update Explosions
    explosionsRef.current.forEach((exp, index) => {
      exp.life--;
      if (exp.life > EXPLOSION_DURATION / 2) {
        exp.radius = exp.maxRadius * (1 - (exp.life - EXPLOSION_DURATION / 2) / (EXPLOSION_DURATION / 2));
      } else {
        exp.radius = exp.maxRadius * (exp.life / (EXPLOSION_DURATION / 2));
      }

      rocketsRef.current.forEach((rocket, rIndex) => {
        const d = Math.sqrt(Math.pow(rocket.x - exp.x, 2) + Math.pow(rocket.y - exp.y, 2));
        if (d < exp.radius) {
          rocketsRef.current.splice(rIndex, 1);
          setScore(s => {
            const newScore = s + 20;
            if (newScore >= WIN_SCORE) setGameState('won');
            return newScore;
          });
        }
      });

      if (exp.life <= 0) {
        explosionsRef.current.splice(index, 1);
      }
    });

    // 5. Check Game Over
    const activeTurrets = turretsRef.current.filter(t => t.active);
    if (activeTurrets.length === 0) {
      setGameState('lost');
    }

    // 6. Update Stars (Twinkle)
    starsRef.current.forEach(star => {
      star.phase += star.twinkleSpeed;
      star.opacity = 0.3 + Math.abs(Math.sin(star.phase)) * 0.7;
    });
  }, [startNextWave]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw Stars
    starsRef.current.forEach(star => {
      ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity})`;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
      
      // Optional: Add a small glow to larger stars
      if (star.size > 1.5) {
        ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity * 0.3})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Draw Ground
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, CANVAS_HEIGHT - 40, CANVAS_WIDTH, 40);

    // Draw Cities
    citiesRef.current.forEach(city => {
      if (city.active) {
        ctx.fillStyle = '#4ecca3';
        ctx.fillRect(city.x - 15, city.y - 15, 30, 15);
        ctx.fillStyle = '#45b293';
        ctx.fillRect(city.x - 10, city.y - 25, 20, 10);
      } else {
        ctx.fillStyle = '#333';
        ctx.fillRect(city.x - 15, city.y - 5, 30, 5);
      }
    });

    // Draw Turrets
    turretsRef.current.forEach(turret => {
      if (turret.active) {
        ctx.fillStyle = '#f6cd61';
        ctx.beginPath();
        ctx.arc(turret.x, turret.y, 20, Math.PI, 0);
        ctx.fill();
        // Barrel
        ctx.strokeStyle = '#f6cd61';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(turret.x, turret.y - 15);
        ctx.lineTo(turret.x, turret.y - 30);
        ctx.stroke();
        
        // Ammo text
        ctx.fillStyle = '#fff';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(turret.ammo.toString(), turret.x, turret.y + 15);
      } else {
        ctx.fillStyle = '#444';
        ctx.beginPath();
        ctx.arc(turret.x, turret.y, 15, Math.PI, 0);
        ctx.fill();
      }
    });

    // Draw Rockets
    ctx.strokeStyle = '#ff4b2b';
    ctx.lineWidth = 1;
    rocketsRef.current.forEach(rocket => {
      ctx.beginPath();
      ctx.moveTo(rocket.x, rocket.y);
      // Draw tail
      const tailLen = 20;
      const dist = Math.sqrt(Math.pow(rocket.targetX - rocket.x, 2) + Math.pow(rocket.targetY - rocket.y, 2));
      const dx = (rocket.targetX - rocket.x) / dist;
      const dy = (rocket.targetY - rocket.y) / dist;
      ctx.lineTo(rocket.x - dx * tailLen, rocket.y - dy * tailLen);
      ctx.stroke();
      
      // Enemy Missile Icon
      ctx.save();
      ctx.translate(rocket.x, rocket.y);
      const angle = Math.atan2(rocket.targetY - rocket.y, rocket.targetX - rocket.x);
      ctx.rotate(angle);
      
      // Body
      ctx.fillStyle = '#ff4b2b';
      ctx.fillRect(-10, -3, 10, 6);
      // Nose
      ctx.beginPath();
      ctx.moveTo(0, -3);
      ctx.lineTo(6, 0);
      ctx.lineTo(0, 3);
      ctx.fill();
      // Fins
      ctx.fillStyle = '#f6cd61'; // Yellowish fins
      ctx.fillRect(-12, -5, 3, 2);
      ctx.fillRect(-12, 3, 3, 2);
      
      // Flame effect at the back
      ctx.fillStyle = '#ff8c00';
      const flameLen = 5 + Math.random() * 5;
      ctx.beginPath();
      ctx.moveTo(-10, -2);
      ctx.lineTo(-10 - flameLen, 0);
      ctx.lineTo(-10, 2);
      ctx.fill();

      ctx.restore();
    });

    // Draw Player Missiles
    ctx.strokeStyle = '#00d2ff';
    ctx.lineWidth = 4;
    missilesRef.current.forEach(missile => {
      ctx.beginPath();
      ctx.moveTo(missile.startX, missile.startY);
      ctx.lineTo(missile.x, missile.y);
      ctx.stroke();

      // Draw Missile Icon at the tip
      ctx.save();
      ctx.translate(missile.x, missile.y);
      const angle = Math.atan2(missile.targetY - missile.startY, missile.targetX - missile.startX);
      ctx.rotate(angle);
      
      ctx.fillStyle = '#00d2ff';
      // Body
      ctx.fillRect(-12, -4, 12, 8);
      // Nose
      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.lineTo(8, 0);
      ctx.lineTo(0, 4);
      ctx.fill();
      // Fins
      ctx.fillStyle = '#fff';
      ctx.fillRect(-14, -7, 4, 3);
      ctx.fillRect(-14, 4, 4, 3);
      
      ctx.restore();
      
      // Target marker
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      const s = 10;
      ctx.beginPath();
      ctx.moveTo(missile.targetX - s, missile.targetY - s);
      ctx.lineTo(missile.targetX + s, missile.targetY + s);
      ctx.moveTo(missile.targetX + s, missile.targetY - s);
      ctx.lineTo(missile.targetX - s, missile.targetY + s);
      ctx.stroke();
    });

    // Draw Explosions
    explosionsRef.current.forEach(exp => {
      const gradient = ctx.createRadialGradient(exp.x, exp.y, 0, exp.x, exp.y, exp.radius);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
      gradient.addColorStop(0.4, 'rgba(255, 165, 0, 0.6)');
      gradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(exp.x, exp.y, exp.radius, 0, Math.PI * 2);
      ctx.fill();
    });

  }, []);

  const render = useCallback(() => {
    update();
    draw();
    frameIdRef.current = requestAnimationFrame(render);
  }, [update, draw]);

  useEffect(() => {
    frameIdRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frameIdRef.current);
  }, [render]);

  const handleCanvasClick = (e: React.MouseEvent | React.TouchEvent) => {
    if (gameState !== 'playing') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    // Find closest turret with ammo
    const availableTurrets = turretsRef.current
      .filter(t => t.active && t.ammo > 0)
      .sort((a, b) => {
        const distA = Math.sqrt(Math.pow(a.x - x, 2) + Math.pow(a.y - y, 2));
        const distB = Math.sqrt(Math.pow(b.x - x, 2) + Math.pow(b.y - y, 2));
        return distA - distB;
      });

    if (availableTurrets.length > 0) {
      const turret = availableTurrets[0];
      turret.ammo--;
      missilesRef.current.push({
        id: Math.random().toString(36).substr(2, 9),
        startX: turret.x,
        startY: turret.y - 20,
        x: turret.x,
        y: turret.y - 20,
        targetX: x,
        targetY: y,
        progress: 0
      });
    }
  };

  const startGame = () => {
    initGame();
    setGameState('playing');
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-emerald-500/30 overflow-hidden flex flex-col">
      {/* Header */}
      <header className="p-4 flex justify-between items-center border-b border-white/5 bg-black/40 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Shield className="text-black w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight leading-none">{t.title}</h1>
            <p className="text-[10px] uppercase tracking-widest text-white/40 font-semibold mt-1">Strategic Defense System</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">{t.score}</p>
            <p className="text-2xl font-mono font-bold text-emerald-400 leading-none">{score.toString().padStart(5, '0')}</p>
          </div>
          <button 
            onClick={() => setLang(l => l === 'en' ? 'zh' : 'en')}
            className="p-2 hover:bg-white/5 rounded-full transition-colors"
          >
            <Globe className="w-5 h-5 text-white/60" />
          </button>
        </div>
      </header>

      {/* Game Area */}
      <main className="flex-1 relative flex items-center justify-center p-4">
        <div 
          className="relative shadow-2xl shadow-black rounded-xl overflow-hidden border border-white/10"
          style={{ width: dimensions.width, height: dimensions.height }}
        >
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="w-full h-full cursor-crosshair touch-none"
            onClick={handleCanvasClick}
            onTouchStart={handleCanvasClick}
          />

          {/* Overlays */}
          <AnimatePresence>
            {gameState === 'start' && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-center items-center justify-center z-20"
              >
                <div className="text-center p-8 max-w-md">
                  <motion.div
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    className="mb-8"
                  >
                    <Target className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
                    <h2 className="text-4xl font-bold mb-2">{t.title}</h2>
                    <p className="text-white/60">{t.instructions}</p>
                  </motion.div>
                  <button
                    onClick={startGame}
                    className="px-8 py-4 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl transition-all transform hover:scale-105 active:scale-95 shadow-xl shadow-emerald-500/20"
                  >
                    {t.start}
                  </button>
                </div>
              </motion.div>
            )}

            {(gameState === 'won' || gameState === 'lost') && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-30"
              >
                <div className="text-center p-12">
                  <motion.div
                    initial={{ scale: 0.5, rotate: -10 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', damping: 12 }}
                  >
                    {gameState === 'won' ? (
                      <Trophy className="w-24 h-24 text-yellow-400 mx-auto mb-6" />
                    ) : (
                      <AlertTriangle className="w-24 h-24 text-red-500 mx-auto mb-6" />
                    )}
                  </motion.div>
                  
                  <h2 className={`text-5xl font-black mb-2 uppercase tracking-tighter ${gameState === 'won' ? 'text-yellow-400' : 'text-red-500'}`}>
                    {gameState === 'won' ? t.win : t.loss}
                  </h2>
                  
                  <div className="mb-8">
                    <p className="text-white/40 uppercase tracking-widest text-xs font-bold mb-1">{t.score}</p>
                    <p className="text-6xl font-mono font-black text-white">{score}</p>
                  </div>

                  <button
                    onClick={startGame}
                    className="flex items-center gap-3 px-10 py-5 bg-white text-black font-black rounded-2xl hover:bg-emerald-400 transition-all transform hover:scale-110 active:scale-90"
                  >
                    <RotateCcw className="w-6 h-6" />
                    {t.restart}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* HUD Overlay (In-game) */}
          {gameState === 'playing' && (
            <>
              <div className="absolute top-4 left-4 pointer-events-none flex flex-col gap-2">
                <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-lg p-2 px-4">
                  <p className="text-[8px] uppercase tracking-widest text-white/40 font-bold leading-none mb-1">Target</p>
                  <p className="text-lg font-mono font-bold text-yellow-400 leading-none">{WIN_SCORE}</p>
                </div>
                <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-lg p-2 px-4">
                  <p className="text-[8px] uppercase tracking-widest text-white/40 font-bold leading-none mb-1">{t.wave || 'Wave'}</p>
                  <p className="text-lg font-mono font-bold text-white leading-none">{wave}</p>
                </div>
              </div>

              <AnimatePresence>
                {isWaveTransition && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.2 }}
                    className="absolute inset-0 flex items-center justify-center pointer-events-none"
                  >
                    <div className="bg-emerald-500/20 backdrop-blur-md border border-emerald-500/50 rounded-2xl p-8 text-center">
                      <h2 className="text-4xl font-black text-emerald-400 uppercase tracking-tighter italic">
                        {t.waveCleared || 'Wave Cleared!'}
                      </h2>
                      <p className="text-white/60 mt-2 font-mono">REARMING SYSTEMS...</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </div>
      </main>

      {/* Footer / Controls Info */}
      <footer className="p-4 text-center border-t border-white/5 bg-black/40">
        <p className="text-[10px] uppercase tracking-[0.3em] text-white/20 font-bold">
          &copy; 2026 TINA NOVA DEFENSE • ALL SYSTEMS OPERATIONAL
        </p>
      </footer>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes pulse-emerald {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        .animate-pulse-emerald {
          animation: pulse-emerald 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      `}} />
    </div>
  );
}
