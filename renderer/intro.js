// SBK cinematics: launch intro + new-member welcome. Plain script, exposes window.SBKIntro.
(function () {
  const GOLD = '#FFD600', BLUE = '#5A8CFF', WHITE = '#FFFFFF';
  const logo = new Image();
  logo.src = 'assets/logo.png';

  function boltPath(w, h, seed) {
    let r = seed * 9301 + 49297;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    let x = w * (0.15 + rnd() * 0.7), y = 0;
    const pts = [[x, y]];
    const end = h * (0.45 + rnd() * 0.4);
    while (y < end) { y += 40 + rnd() * 70; x += (rnd() - 0.5) * 120; pts.push([x, y]); }
    return pts;
  }

  function play(opts = {}) {
    const big = !!opts.welcome;
    const name = (opts.name || '').toUpperCase();
    const DUR = big ? 6.2 : 3.4;
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'cine';
      const c = document.createElement('canvas');
      const skip = document.createElement('div');
      skip.className = 'cine-skip';
      skip.textContent = 'click to skip';
      wrap.appendChild(c); wrap.appendChild(skip);
      document.body.appendChild(wrap);
      const ctx = c.getContext('2d');
      const fit = () => { c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; };
      fit(); addEventListener('resize', fit);

      const audio = new Audio(big ? 'assets/welcome.wav' : 'assets/intro.wav');
      audio.volume = 0.8;
      audio.play().catch(() => {});

      const strikes = big ? [0, 0.18, 1.6, 3.0, 3.12, 4.6] : [0, 0.2, 1.1];
      const rain = Array.from({ length: 140 }, (_, i) => [Math.random(), Math.random(), 0.6 + Math.random() * 0.8]);
      const sparks = Array.from({ length: 70 }, () => [Math.random() * Math.PI * 2, 0.4 + Math.random() * 1.2, Math.random()]);
      let t0 = performance.now(), done = false;

      const finish = () => {
        if (done) return; done = true;
        wrap.classList.add('out');
        audio.volume = 0.3;
        setTimeout(() => { wrap.remove(); removeEventListener('resize', fit); resolve(); }, 450);
      };
      wrap.addEventListener('click', finish);

      const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
      const pop = (t, s, d = 0.35) => { const p = (t - s) / d; if (p <= 0) return 0; if (p >= 1) return 1; return ease(p) + 0.25 * Math.sin(p * Math.PI) * (1 - p); };

      function text(str, x, y, size, color, alpha = 1, stroke = true) {
        if (size < 2) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = `800 ${size}px Poppins, "Segoe UI", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (stroke) { ctx.lineWidth = size * 0.12; ctx.strokeStyle = '#080A18'; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
        ctx.shadowColor = color; ctx.shadowBlur = size * 0.35;
        ctx.fillStyle = color; ctx.fillText(str, x, y);
        ctx.restore();
      }

      function frame(now) {
        if (done) return;
        const t = (now - t0) / 1000;
        const W = c.width, H = c.height, u = Math.min(W, H) / 100;
        // storm background
        const g = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.75);
        g.addColorStop(0, big ? '#2E1E78' : '#26185F'); g.addColorStop(1, '#05060F');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        // rain
        ctx.strokeStyle = 'rgba(150,175,255,0.28)'; ctx.lineWidth = u * 0.18;
        ctx.beginPath();
        for (const [rx, ry, sp] of rain) {
          const x = ((rx * W + t * 300 * sp) % (W + 100)) - 50;
          const y = ((ry * H + t * H * 1.4 * sp) % (H + 100)) - 50;
          ctx.moveTo(x, y); ctx.lineTo(x - u * 0.8, y + u * 3);
        }
        ctx.stroke();
        // lightning
        let flash = 0;
        strikes.forEach((s, i) => {
          if (t >= s && t < s + 0.2) {
            const a = 1 - (t - s) / 0.2; flash = Math.max(flash, a);
            const pts = boltPath(W, H, i + 3);
            ctx.save(); ctx.strokeStyle = `rgba(210,225,255,${a})`; ctx.shadowColor = '#BFD0FF'; ctx.shadowBlur = u * 4;
            ctx.lineWidth = u * 0.6; ctx.lineJoin = 'round'; ctx.beginPath();
            pts.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.restore();
          }
        });
        // shake on impact
        const impact = big ? 1.6 : 0.2;
        const sh = t > impact && t < impact + 0.35 ? (1 - (t - impact) / 0.35) * u * 1.2 : 0;
        const sx = (Math.random() - 0.5) * sh, sy = (Math.random() - 0.5) * sh;

        // logo slam
        const ls = big ? pop(t, 1.5, 0.45) : pop(t, 0.15, 0.4);
        const lsz = (big ? 36 : 50) * u * (0.55 + 0.45 * ls) * (1 + 0.015 * Math.sin(t * 6));
        const ly = H * (big ? 0.43 : 0.4);
        if (ls > 0 && logo.complete) {
          ctx.save(); ctx.globalAlpha = Math.min(1, ls);
          ctx.shadowColor = GOLD; ctx.shadowBlur = u * 6 * ls;
          ctx.drawImage(logo, W / 2 - lsz / 2 + sx, ly - lsz / 2 + sy, lsz, lsz);
          ctx.restore();
        }
        // sparks burst
        if (t > impact) {
          const k = Math.min(1, (t - impact) / 1.2);
          ctx.save(); ctx.globalAlpha = 1 - k; ctx.fillStyle = GOLD;
          for (const [ang, spd, sz] of sparks) {
            const d = k * spd * 40 * u;
            ctx.beginPath(); ctx.arc(W / 2 + Math.cos(ang) * d, ly + Math.sin(ang) * d, (0.3 + sz * 0.5) * u, 0, 7); ctx.fill();
          }
          ctx.restore();
        }

        if (!big) {
          text('STORM BREAKERS', W / 2, H * 0.74, 7.5 * u * pop(t, 0.6), GOLD);
          text('[SBK]', W / 2, H * 0.83, 4.5 * u * pop(t, 0.95), BLUE);
        } else {
          text('WELCOME TO', W / 2, H * 0.08, 4 * u * pop(t, 0.25), WHITE);
          text('THE STORM', W / 2, H * 0.16, 7 * u * pop(t, 0.6), GOLD);
          text(name || 'NEW MEMBER', W / 2, H * 0.69, 7.5 * u * pop(t, 3.0), GOLD);
          if (t > 3.6) {
            const p = ease((t - 3.6) / 0.3);
            const bw = 34 * u * p, bh = 6 * u;
            ctx.save(); ctx.fillStyle = BLUE; ctx.shadowColor = BLUE; ctx.shadowBlur = u * 3;
            ctx.beginPath(); ctx.roundRect(W / 2 - bw / 2, H * 0.785 - bh / 2, bw, bh, bh / 2); ctx.fill(); ctx.restore();
            if (p > 0.7) text('STORM BREAKERS [SBK]', W / 2, H * 0.785, 2.6 * u, WHITE, 1, false);
          }
          text('you\'re officially in. let\'s get those dubs ⚡', W / 2, H * 0.875, 2.4 * u * pop(t, 4.3), WHITE);
        }

        if (flash) { ctx.fillStyle = `rgba(230,235,255,${0.4 * flash})`; ctx.fillRect(0, 0, W, H); }
        if (t >= DUR) return finish();
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  window.SBKIntro = { play };
})();
