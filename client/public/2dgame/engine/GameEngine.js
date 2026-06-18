class GameEngine {
  constructor({
    canvas,
    timerElement,
    dialogElement,
    stagePath,
    fighterPaths,
    autonomous = false,
    arenaSeed = null,
    stageVariantId = null,
    rootElement = null,
    assetBasePath = "",
    soundEnabled = true,
    onArenaAdvance = null,
  }) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.timerElement = timerElement;
    this.dialogElement = dialogElement;
    this.rootElement = rootElement || canvas.closest(".bantah-fighting-game") || document;
    this.stagePath = stagePath;
    this.fighterPaths = fighterPaths;
    this.autonomous = autonomous;
    this.arenaSeed = arenaSeed;
    this.stageVariantId = stageVariantId;
    this.assetBasePath = assetBasePath;

    this.stage = null;
    this.background = null;
    this.decorations = [];
    this.fighters = [];
    this.fighterConfigs = [];
    this.input = null;
    this.moveResolver = null;
    this.round = null;
    this.roundNumber = 1;
    this.arenaState = null;
    this.arenaRoundKey = null;
    this.arenaRoundStartedAt = typeof window !== "undefined" ? window.performance?.now?.() || Date.now() : Date.now();
    this.minimumAutonomousRoundSeconds = 42;
    this.arenaCue = null;
    this.arenaWatchReward = null;
    this.arenaRngSeed = null;
    this.rngState = this.hashSeed(autonomous ? "arena-boot" : "freeplay");
    this.pendingArenaPayload = null;
    this.animationFrameId = null;
    this.destroyed = false;
    this.mechanics = "classic";
    this.projectiles = [];
    this.floatingFx = [];
    this.spriteFx = [];
    this.vfxImages = {};
    this.turnState = null;
    this.audioContext = null;
    this.audioUnlockHandler = null;
    this.audioUnlockTargets = [];
    this.audioUnlockEvents = ["pointerdown", "touchstart", "touchend", "mousedown", "click", "keydown"];
    this.audioPrimed = false;
    this.audioUnlocked = false;
    this.soundEnabled = soundEnabled !== false;
    this.onArenaAdvance = typeof onArenaAdvance === "function" ? onArenaAdvance : null;
    this.musicElement = null;
    this.musicSrc = this.resolveAssetPath("bgm.ogg");
    this.musicVolume = 0.25;
    this.musicPauseIntent = false;
    this.musicResumeTimeout = null;
    this.sampleSfxSources = this.createSampleSfxSources();
    this.sampleSfxElements = {};
    this.sampleSfxBuffers = {};
    this.sampleSfxBufferPromises = {};
    this.sampleSfxCursor = {};
    this.lastSfxAt = {};
    this.autonomousRestartTimeout = null;
  }

  async start() {
    const [stageConfig, ...fighterConfigs] = await Promise.all([
      AssetLoader.loadJSON(this.stagePath),
      ...this.fighterPaths.map((path) => AssetLoader.loadJSON(path)),
    ]);

    const selectedStageConfig = this.selectStageConfig(stageConfig);
    this.applyMascotLoadout(fighterConfigs);
    this.normalizeConfigAssetPaths(selectedStageConfig);
    fighterConfigs.forEach((config) => this.normalizeConfigAssetPaths(config));

    await AssetLoader.preloadImages(
      AssetLoader.collectImageSources(selectedStageConfig, fighterConfigs),
    );

    if (this.destroyed) return;

    this.stage = selectedStageConfig;
    this.fighterConfigs = fighterConfigs;
    this.mechanics = this.detectMechanics(fighterConfigs);
    this.canvas.width = selectedStageConfig.canvas.width;
    this.canvas.height = selectedStageConfig.canvas.height;

    window.canvas = this.canvas;
    window.canvas2dContext = this.context;
    window.gravity = stageConfig.gravity;

    this.background = this.createSprite(selectedStageConfig.background);
    this.decorations = (selectedStageConfig.decorations || []).map((decoration) =>
      this.createSprite(decoration),
    );
    this.fighters = fighterConfigs.map((config) => this.createFighter(config));

    this.input = new InputManager(this.createBindings(fighterConfigs));
    this.moveResolver = new MoveResolver(fighterConfigs);
    this.round = this.createRoundManager();
    this.round.start();
    this.prepareMechanics();
    this.preloadSampleSfx();
    this.syncBackgroundMusic();
    if (this.pendingArenaPayload) {
      this.applyArenaPayload(this.pendingArenaPayload);
      this.pendingArenaPayload = null;
    }

    this.animate();
  }

  destroy() {
    this.destroyed = true;
    if (this.animationFrameId) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.round?.destroy();
    this.clearAutonomousRestart();
    this.input?.destroy();
    this.removeAudioUnlock();
    this.clearMusicResumeTimeout();
    this.releaseBackgroundMusic();
    this.scheduleSharedBackgroundMusicStop();
    if (this.musicElement) {
      const sharedMusicElement = typeof window !== "undefined" ? window.__botaArenaMusicElement : null;
      if (typeof window !== "undefined" && this.musicElement !== sharedMusicElement) {
        window.__botaArenaMusicElements?.delete?.(this.musicElement);
        this.musicElement.src = "";
      }
      this.musicElement = null;
    }
    this.projectiles = [];
    this.floatingFx = [];
    this.spriteFx = [];
    this.queryAll(".damage-trail, .hit-spark, .damage-number, .win-confetti").forEach((element) =>
      element.remove(),
    );
    if (window.gameEngine === this) {
      window.gameEngine = null;
    }
  }

  query(selector) {
    return this.rootElement?.querySelector?.(selector) || document.querySelector(selector);
  }

  queryAll(selector) {
    return Array.from(
      this.rootElement?.querySelectorAll?.(selector) || document.querySelectorAll(selector),
    );
  }

  normalizeConfigAssetPaths(value) {
    if (!value || typeof value !== "object") return value;

    if (Array.isArray(value)) {
      value.forEach((entry) => this.normalizeConfigAssetPaths(entry));
      return value;
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      if ((key === "imageSrc" || key === "avatarSrc") && typeof nestedValue === "string") {
        value[key] = this.resolveAssetPath(nestedValue);
      } else {
        this.normalizeConfigAssetPaths(nestedValue);
      }
    }

    return value;
  }

  resolveAssetPath(assetPath) {
    if (
      !assetPath ||
      /^(?:[a-z]+:)?\/\//i.test(assetPath) ||
      assetPath.startsWith("/") ||
      assetPath.startsWith("data:")
    ) {
      return assetPath;
    }

    const base = this.assetBasePath ? this.assetBasePath.replace(/\/?$/, "/") : "";
    return `${base}${assetPath}`;
  }

  createSprite(config) {
    return new Sprite({
      ...this.clone(config),
      context: this.context,
      canvasElement: this.canvas,
      gravityValue: this.stage.gravity,
    });
  }

  createRoundManager() {
    return new RoundManager({
      seconds: this.stage.roundSeconds,
      timerElement: this.timerElement,
      dialogElement: this.dialogElement,
      fighters: this.fighters,
      onFinish: (result) => this.handleRoundFinish(result),
      onRestart: () => this.handleRoundContinue(),
      resolveWinner: (context) => this.resolveRoundWinner(context),
      getResultContext: (context) => this.buildRoundResultContext(context),
      roundNumber: this.roundNumber,
      roundLabelElement: this.query(".round-label"),
      roundDotsElement: this.query(".round-dots"),
    });
  }

  handleRoundContinue() {
    this.dismissResultDialog();

    if (this.autonomous && this.arenaState?.battleId) {
      this.requestArenaAdvance("result-dismiss");
      return;
    }

    this.restartRound();
  }

  requestArenaAdvance(reason = "result-dismiss") {
    const detail = {
      reason,
      battleId: this.arenaState?.battleId || null,
      roundKey: this.arenaRoundKey || null,
      generatedAt: new Date().toISOString(),
    };

    if (this.onArenaAdvance) {
      this.onArenaAdvance(detail);
      return;
    }

    this.rootElement?.dispatchEvent?.(
      new CustomEvent("bantahbro:arena-advance", {
        detail,
        bubbles: true,
      }),
    );

    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "bantahbro:arena-advance", ...detail }, "*");
    }
  }

  handleRoundFinish(result = {}) {
    this.stopRoundActions();
    this.markRoundDefeatStates(result);

    if (result.winner?.fighter) {
      this.spawnWinConfetti(result.winner.fighter);
      this.playSfx("win", result.winner.fighter);
    }

    if (!this.autonomous) return;

    this.clearAutonomousRestart();
    if (this.arenaState?.battleId) {
      return;
    }

    this.autonomousRestartTimeout = window.setTimeout(() => {
      this.autonomousRestartTimeout = null;
      if (this.destroyed || !this.round?.finished) return;
      this.restartRound();
    }, 2400);
  }

  clearAutonomousRestart() {
    if (!this.autonomousRestartTimeout) return;
    window.clearTimeout(this.autonomousRestartTimeout);
    this.autonomousRestartTimeout = null;
  }

  markRoundDefeatStates(result = {}) {
    const winner = result.winner?.fighter;
    if (!winner) return;

    this.fighters.forEach((fighter) => {
      if (fighter === winner) return;
      this.markFighterDamaged(fighter, 720);
      fighter.health = 0;
      fighter.dead = false;
      fighter.velocity.x = 0;
      fighter.velocity.y = 0;
      fighter.setState("dead", { force: true });
      this.updateHealthBar(fighter);
      if (this.mechanics === "mascot_tactics") {
        const center = this.getMascotCore(fighter);
        this.spawnSpriteFx("smokeImpact", center.x, center.y + 44, {
          scale: 0.74,
          alpha: 0.82,
        });
        this.spawnFloatingFx(fighter, "DEFEATED", "#ff372f");
        this.playSfx("death", fighter);
      }
    });
  }

  spawnWinConfetti(winner) {
    const host = this.rootElement || this.canvas.parentElement;
    if (!host) return;

    this.queryAll(".win-confetti").forEach((element) => element.remove());

    const burst = document.createElement("div");
    burst.className = `win-confetti win-burst ${winner?.playerId === "player2" ? "from-right" : "from-left"}`;
    burst.setAttribute("aria-hidden", "true");

    const originX = winner?.playerId === "player2" ? 67 : 33;
    const originY = 45;
    burst.style.setProperty("--origin-x", `${originX}%`);
    burst.style.setProperty("--origin-y", `${originY}%`);

    const core = document.createElement("i");
    core.className = "burst-core";
    burst.append(core);

    const ring = document.createElement("i");
    ring.className = "burst-ring";
    burst.append(ring);

    const rayCount = 12;
    for (let index = 0; index < rayCount; index += 1) {
      const ray = document.createElement("span");
      ray.className = "burst-ray";
      ray.style.setProperty("--angle", `${index * (360 / rayCount) + (this.random() - 0.5) * 10}deg`);
      ray.style.setProperty("--ray-scale", `${0.72 + this.random() * 0.42}`);
      ray.style.animationDelay = `${this.random() * 45}ms`;
      burst.append(ray);
    }

    const sparkColors = ["#fff8a6", "#ffffff", "#7dfcff", "#a8ff58", "#ffb347"];
    for (let index = 0; index < 26; index += 1) {
      const spark = document.createElement("span");
      const angle = this.random() * Math.PI * 2;
      const distance = 48 + this.random() * 142;
      const size = 3 + this.random() * 6;
      spark.className = this.random() > 0.62 ? "burst-shard" : "burst-spark";
      spark.style.width = `${size}px`;
      spark.style.height = `${size}px`;
      spark.style.background = sparkColors[index % sparkColors.length];
      spark.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
      spark.style.setProperty("--dy", `${Math.sin(angle) * distance - 18}px`);
      spark.style.setProperty("--spin", `${(this.random() > 0.5 ? 1 : -1) * (120 + this.random() * 260)}deg`);
      spark.style.animationDelay = `${40 + this.random() * 120}ms`;
      burst.append(spark);
    }

    host.append(burst);
    window.setTimeout(() => burst.remove(), 1250);
  }

  detectMechanics(fighterConfigs) {
    return fighterConfigs.some((config) => config.mechanics === "mascot_tactics")
      ? "mascot_tactics"
      : "classic";
  }

  prepareMechanics() {
    this.rootElement?.classList?.toggle?.("is-mascot-arena", this.mechanics === "mascot_tactics");
    this.projectiles = [];
    this.floatingFx = [];
    this.spriteFx = [];
    this.setupAudioUnlock();

    if (this.mechanics === "mascot_tactics") {
      this.loadMascotVfxAssets();
      this.initializeMascotTactics();
    } else {
      this.turnState = null;
    }
  }

  loadMascotVfxAssets() {
    const sources = {
      flame: "image/vfx/flame-impact-sheet.png",
      water: "image/vfx/water-burst-sheet.png",
      smokeImpact: "image/vfx/smoke-impact-sheet.png",
      smokeDash: "image/vfx/smoke-dash-sheet.png",
    };

    for (const [key, assetPath] of Object.entries(sources)) {
      if (this.vfxImages[key]) continue;
      const image = new Image();
      image.src = this.resolveAssetPath(assetPath);
      this.vfxImages[key] = image;
    }
  }

  initializeMascotTactics() {
    const order = this.fighters
      .map((fighter, index) => ({ fighter, index, speed: fighter.speedStat || 50 }))
      .sort((a, b) => b.speed - a.speed)
      .map((entry) => entry.index);

    this.turnState = {
      order,
      cursor: 0,
      nextTurnAt: this.now() + 700 + this.random() * 360,
      turnNumber: 0,
      lastActorIndex: null,
      repeatedActorCount: 0,
      chaos: 0.76 + this.random() * 0.52,
    };

    this.fighters.forEach((fighter) => {
      fighter.homeX = fighter.position.x;
      fighter.homeY = fighter.position.y;
      fighter.mascotMotion = null;
      fighter.energy = Number.isFinite(fighter.energy) ? fighter.energy : 3;
      fighter.maxEnergy = fighter.maxEnergy || 6;
      fighter.cooldowns = fighter.cooldowns || {};
      fighter.shield = Math.max(0, fighter.shield || 0);
      fighter.velocity.x = 0;
      fighter.velocity.y = 0;
      fighter.setState("stand", { force: true });
      this.updateEnergyHud(fighter);
    });
    this.syncMascotHudPortraits();
  }

  updateMascotFloat() {
    const now = this.now();
    this.fighters.forEach((fighter) => {
      const motionOffset = this.updateMascotMotion(fighter, now);
      fighter.renderOffsetY = 40 + motionOffset.y;
      fighter.renderOffsetX = motionOffset.x;
    });
  }

  updateMascotMotion(fighter, now = this.now()) {
    const motion = fighter.mascotMotion;
    if (!motion) return { x: 0, y: 0 };

    const progress = Math.min(1, (now - motion.startedAt) / motion.duration);
    const homeX = motion.homeX ?? fighter.homeX ?? fighter.position.x;
    const reachX = homeX + (motion.direction || 1) * (motion.reach || 46);

    if (motion.kind === "lunge") {
      if (progress < 0.32) {
        const local = progress / 0.32;
        const localEase = local < 0.5
          ? 2 * local * local
          : 1 - Math.pow(-2 * local + 2, 2) / 2;
        fighter.position.x = homeX + (reachX - homeX) * localEase;
        fighter.setMovementState("walk");
      } else if (progress < 0.74) {
        fighter.position.x = reachX;
        fighter.setState("attack");
      } else {
        const returnProgress = (progress - 0.74) / 0.26;
        const localEase = returnProgress < 0.5
          ? 2 * returnProgress * returnProgress
          : 1 - Math.pow(-2 * returnProgress + 2, 2) / 2;
        fighter.position.x = reachX + (homeX - reachX) * localEase;
        if (fighter.canControl()) fighter.setMovementState("walk");
      }
    } else if (motion.kind === "hop") {
      if (progress < 0.5) {
        fighter.setMovementState("jump");
      } else if (fighter.canControl()) {
        fighter.setMovementState("fall");
      }
      if (progress > 0.56 && motion.attackAtPeak && fighter.canControl()) {
        fighter.setState("attack");
      }
      fighter.position.x = homeX;
    }

    if (progress >= 1) {
      fighter.position.x = homeX;
      fighter.mascotMotion = null;
      if (fighter.canControl()) fighter.setMovementState("stand");
      return { x: 0, y: 0 };
    }

    return {
      x: 0,
      y: motion.kind === "hop" ? -Math.sin(progress * Math.PI) * (motion.lift || 20) : 0,
    };
  }

  getMascotVisualMetrics(fighter) {
    const frameWidth = fighter.frameWidth || (fighter.image?.width
      ? fighter.image.width / Math.max(1, fighter.totalFrames || 1)
      : fighter.width || 160);
    const frameHeight = fighter.frameHeight || fighter.image?.height || fighter.height || 130;
    const width = frameWidth * (fighter.scale || 1);
    const height = frameHeight * (fighter.scale || 1);
    const x = fighter.position.x - fighter.offset.x + (fighter.renderOffsetX || 0);
    const y = fighter.position.y - fighter.offset.y + (fighter.renderOffsetY || 0);

    return {
      x,
      y,
      width,
      height,
      centerX: x + width / 2,
      centerY: y + height / 2,
      bottomY: y + height,
    };
  }

  drawMascotGroundShadows() {
    this.fighters.forEach((fighter) => {
      if (fighter.health <= 0 || fighter.dead) return;

      const metrics = this.getMascotVisualMetrics(fighter);
      const lift = Math.max(0, 18 - Math.abs(fighter.renderOffsetY || 0));
      const alpha = 0.22 + lift / 140;
      const shadowYOffset = Number(fighter.tactics?.shadowOffsetY ?? -4);
      const shadowScaleX = Number(fighter.tactics?.shadowScaleX ?? 0.3);
      const shadowScaleY = Number(fighter.tactics?.shadowScaleY ?? 0.042);

      this.context.save();
      this.context.fillStyle = `rgba(16, 23, 36, ${alpha})`;
      this.context.filter = "blur(2.5px)";
      this.context.beginPath();
      this.context.ellipse(
        metrics.centerX,
        metrics.bottomY + shadowYOffset,
        metrics.width * shadowScaleX,
        Math.max(6, metrics.height * shadowScaleY),
        0,
        0,
        Math.PI * 2,
      );
      this.context.fill();
      this.context.restore();
    });
  }

  roundedRectPath(x, y, width, height, radius) {
    const resolvedRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
    this.context.beginPath();
    this.context.moveTo(x + resolvedRadius, y);
    this.context.lineTo(x + width - resolvedRadius, y);
    this.context.quadraticCurveTo(x + width, y, x + width, y + resolvedRadius);
    this.context.lineTo(x + width, y + height - resolvedRadius);
    this.context.quadraticCurveTo(x + width, y + height, x + width - resolvedRadius, y + height);
    this.context.lineTo(x + resolvedRadius, y + height);
    this.context.quadraticCurveTo(x, y + height, x, y + height - resolvedRadius);
    this.context.lineTo(x, y + resolvedRadius);
    this.context.quadraticCurveTo(x, y, x + resolvedRadius, y);
    this.context.closePath();
  }

  isEnsArenaSide(side, fighter) {
    const candidates = [
      side?.dataSource,
      side?.chainLabel,
      side?.label,
      side?.agentName,
      side?.tokenName,
      fighter?.displayName,
    ].map((value) => String(value || "").trim().toLowerCase());

    return candidates.some((value) =>
      value === "ens-subgraph" ||
      value === "ens" ||
      value.endsWith(".eth") ||
      value.includes(".eth "),
    );
  }

  readFighterNameBadge(side, fighter) {
    if (!this.isEnsArenaSide(side, fighter)) return "";
    const candidates = [
      side?.ensName,
      side?.agentName,
      side?.label,
      side?.tokenName,
      fighter?.displayName,
    ];
    const ensName = candidates
      .map((value) => String(value || "").trim())
      .find((value) => value.toLowerCase().endsWith(".eth"));
    return ensName || "";
  }

  fitBadgeText(text, maxWidth) {
    const value = String(text || "").trim();
    if (!value) return "";
    if (this.context.measureText(value).width <= maxWidth) return value;

    const extension = value.toLowerCase().endsWith(".eth") ? ".eth" : "";
    const label = extension ? value.slice(0, -extension.length) : value;
    let next = label;
    while (next.length > 4 && this.context.measureText(`${next}...${extension}`).width > maxWidth) {
      next = next.slice(0, -1);
    }
    return `${next}...${extension}`;
  }

  drawFighterNameBadges() {
    if (!this.fighters?.length || !this.arenaState) return;
    const compact = this.isCompactArenaViewport();
    const fontSize = compact ? 12 : 14;
    const chipFontSize = compact ? 8 : 9;
    const height = compact ? 22 : 26;
    const paddingX = compact ? 8 : 10;
    const chipWidth = compact ? 24 : 28;
    const chipGap = compact ? 5 : 6;
    const maxBadgeWidth = compact ? 148 : 198;

    this.context.save();
    this.fighters.forEach((fighter) => {
      if (!fighter || fighter.health <= 0 || fighter.dead) return;
      const side = this.getArenaSideForFighter(fighter);
      const badgeText = this.readFighterNameBadge(side, fighter);
      if (!badgeText) return;

      const metrics = this.getMascotVisualMetrics(fighter);
      if (!metrics.width || !metrics.height) return;

      this.context.font = `700 ${fontSize}px LilitaOne, "Lilita One", Inter, system-ui, sans-serif`;
      const fittedText = this.fitBadgeText(badgeText, maxBadgeWidth - chipWidth - chipGap - paddingX * 2);
      const textWidth = this.context.measureText(fittedText).width;
      const width = Math.min(maxBadgeWidth, Math.max(compact ? 92 : 108, textWidth + chipWidth + chipGap + paddingX * 2));
      const x = Math.max(12, Math.min(this.canvas.width - width - 12, metrics.centerX - width / 2));
      const y = Math.max(18, metrics.y + metrics.height * 0.06 - height);
      const pulse = 0.5 + Math.sin(this.now() / 620 + metrics.centerX * 0.01) * 0.5;
      const sideHue = fighter.playerId === "player2" ? "#b5ff35" : "#7dfcff";

      this.context.shadowColor = `rgba(0, 0, 0, ${0.32 + pulse * 0.12})`;
      this.context.shadowBlur = compact ? 7 : 10;
      this.context.shadowOffsetY = 3;
      this.roundedRectPath(x, y, width, height, 8);
      const gradient = this.context.createLinearGradient(x, y, x + width, y + height);
      gradient.addColorStop(0, "rgba(3, 12, 31, 0.92)");
      gradient.addColorStop(0.52, "rgba(4, 26, 58, 0.88)");
      gradient.addColorStop(1, "rgba(5, 41, 84, 0.92)");
      this.context.fillStyle = gradient;
      this.context.fill();
      this.context.shadowBlur = 0;
      this.context.lineWidth = compact ? 1 : 1.4;
      this.context.strokeStyle = sideHue;
      this.context.stroke();

      const healthRatio = Math.max(0, Math.min(1, Number(fighter.health || 0) / 100));
      const healthTrackX = x + 8;
      const healthTrackY = y + height - 4;
      const healthTrackWidth = width - 16;
      this.context.lineCap = "round";
      this.context.strokeStyle = "rgba(255, 255, 255, 0.22)";
      this.context.lineWidth = compact ? 1.4 : 1.8;
      this.context.beginPath();
      this.context.moveTo(healthTrackX, healthTrackY);
      this.context.lineTo(healthTrackX + healthTrackWidth, healthTrackY);
      this.context.stroke();
      this.context.strokeStyle =
        healthRatio > 0.62 ? "#a9ff26" : healthRatio > 0.34 ? "#ffd33d" : "#ff3f37";
      this.context.beginPath();
      this.context.moveTo(healthTrackX, healthTrackY);
      this.context.lineTo(healthTrackX + healthTrackWidth * healthRatio, healthTrackY);
      this.context.stroke();
      this.context.lineCap = "butt";

      const chipX = x + paddingX;
      const chipY = y + (height - (compact ? 14 : 16)) / 2;
      const chipHeight = compact ? 14 : 16;
      this.roundedRectPath(chipX, chipY, chipWidth, chipHeight, 5);
      this.context.fillStyle = "rgba(108, 131, 255, 0.96)";
      this.context.fill();
      this.context.lineWidth = 1;
      this.context.strokeStyle = "rgba(255, 255, 255, 0.78)";
      this.context.stroke();

      this.context.font = `700 ${chipFontSize}px LilitaOne, "Lilita One", Inter, system-ui, sans-serif`;
      this.context.fillStyle = "#ffffff";
      this.context.textAlign = "center";
      this.context.textBaseline = "middle";
      this.context.fillText("ENS", chipX + chipWidth / 2, chipY + chipHeight / 2 + 0.5);

      this.context.font = `700 ${fontSize}px LilitaOne, "Lilita One", Inter, system-ui, sans-serif`;
      this.context.textAlign = "left";
      this.context.lineWidth = compact ? 1.8 : 2.4;
      this.context.strokeStyle = "rgba(0, 0, 0, 0.68)";
      this.context.strokeText(fittedText, chipX + chipWidth + chipGap, y + height / 2 + 1);
      this.context.fillStyle = "#fffbd1";
      this.context.fillText(fittedText, chipX + chipWidth + chipGap, y + height / 2 + 1);
    });
    this.context.restore();
  }

  syncMascotHudPortraits() {
    if (this.mechanics !== "mascot_tactics") return;

    this.fighters.forEach((fighter, index) => {
      const avatar = this.query(`.player${index + 1} .avatar-ring img`);
      const rankBadge = this.query(`.player${index + 1} .avatar-rank-badge`);
      if (avatar && fighter.mascotAvatar) {
        avatar.src = fighter.mascotAvatar;
      }
      if (rankBadge) {
        const side = this.getArenaSideForFighter(fighter);
        const rank = this.readArenaSideRank(side, fighter, { fallback: false });
        rankBadge.textContent = rank ? String(rank) : "";
        const rankDelta = rank ? this.readArenaRankDelta(side, rank, this.readArenaSpectators(this.arenaState), { fallback: false }) : 0;
        if (rankDelta > 0) {
          rankBadge.setAttribute("data-rank-move", "up");
        } else if (rankDelta < 0) {
          rankBadge.setAttribute("data-rank-move", "down");
        } else {
          rankBadge.removeAttribute("data-rank-move");
        }
        const movementLabel = rankDelta > 0
          ? `, climbed ${rankDelta} ranks`
          : rankDelta < 0
            ? `, dropped ${Math.abs(rankDelta)} ranks`
            : "";
        rankBadge.setAttribute("aria-label", `${fighter.displayName} leaderboard rank${rank ? ` #${rank}` : ""}${movementLabel}`);
      }
    });
  }

  setupAudioUnlock() {
    if (!this.soundEnabled) return;
    if (this.audioUnlockHandler || typeof window === "undefined") return;

    this.audioUnlockHandler = () => {
      const context = this.ensureAudioContext();
      if (!context) return;

      const finishUnlock = () => {
        this.primeAudioContext(context);
        this.audioUnlocked = context.state === "running";
        this.syncBackgroundMusic();
        if (this.audioUnlocked) this.removeAudioUnlock();
      };

      const resumeResult = context.resume?.();
      if (resumeResult?.then) {
        resumeResult.then(finishUnlock).catch(() => undefined);
      } else {
        finishUnlock();
      }
    };

    this.audioUnlockTargets = Array.from(
      new Set([window, document, this.rootElement, this.canvas].filter(Boolean)),
    );

    this.audioUnlockTargets.forEach((target) => {
      this.audioUnlockEvents.forEach((eventName) => {
        target.addEventListener(eventName, this.audioUnlockHandler, { passive: true });
      });
    });
  }

  removeAudioUnlock() {
    if (!this.audioUnlockHandler || typeof window === "undefined") return;
    this.audioUnlockTargets.forEach((target) => {
      this.audioUnlockEvents.forEach((eventName) => {
        target.removeEventListener(eventName, this.audioUnlockHandler);
      });
    });
    this.audioUnlockTargets = [];
    this.audioUnlockHandler = null;
  }

  ensureAudioContext() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    if (!this.audioContext) {
      this.audioContext = new AudioCtor();
    }
    return this.audioContext;
  }

  setSoundEnabled(enabled) {
    this.soundEnabled = Boolean(enabled);
    this.rootElement?.classList?.toggle?.("is-sound-muted", !this.soundEnabled);

    if (!this.soundEnabled) {
      this.audioUnlocked = false;
      this.pauseBackgroundMusic({ reset: true });
      this.releaseBackgroundMusic();
      this.removeAudioUnlock();
      this.audioContext?.suspend?.().catch?.(() => undefined);
      return;
    }

    this.preloadSampleSfx();

    const context = this.ensureAudioContext();
    if (!context) return;

    const finishUnlock = () => {
      this.primeAudioContext(context);
      this.audioUnlocked = context.state === "running";
      this.syncBackgroundMusic();
      if (this.audioUnlocked) this.removeAudioUnlock();
    };

    if (context.state === "suspended") {
      context.resume?.().then?.(finishUnlock).catch?.(() => this.setupAudioUnlock());
      this.setupAudioUnlock();
    } else {
      finishUnlock();
    }
  }

  setupBackgroundMusic() {
    if (this.musicElement || typeof Audio === "undefined") return this.musicElement;

    let music = typeof window !== "undefined" ? window.__botaArenaMusicElement : null;
    if (!music) {
      music = new Audio(this.musicSrc);
      music.loop = true;
      music.preload = "auto";
      music.setAttribute("playsinline", "true");
      music.dataset.botaArenaMusic = "true";
      const handleSharedMusicPause = () => window.__botaArenaMusicOwner?.handleBackgroundMusicPause?.();
      music.addEventListener("pause", handleSharedMusicPause);
      music.addEventListener("ended", handleSharedMusicPause);
      music.addEventListener("stalled", handleSharedMusicPause);
      if (typeof window !== "undefined") {
        window.__botaArenaMusicElement = music;
      }
    }
    music.volume = this.musicVolume;
    if (typeof window !== "undefined") {
      const musicElements = window.__botaArenaMusicElements || new Set();
      musicElements.add(music);
      window.__botaArenaMusicElements = musicElements;
    }
    this.musicElement = music;
    return this.musicElement;
  }

  clearMusicResumeTimeout() {
    if (!this.musicResumeTimeout) return;
    window.clearTimeout(this.musicResumeTimeout);
    this.musicResumeTimeout = null;
  }

  handleBackgroundMusicPause() {
    if (!this.musicElement || !this.soundEnabled || this.destroyed || this.musicPauseIntent) return;
    if (typeof window !== "undefined" && window.__botaArenaMusicOwner && window.__botaArenaMusicOwner !== this) return;

    this.clearMusicResumeTimeout();
    this.musicResumeTimeout = window.setTimeout(() => {
      this.musicResumeTimeout = null;
      if (!this.musicElement || !this.soundEnabled || this.destroyed || this.musicPauseIntent) return;
      if (typeof window !== "undefined" && window.__botaArenaMusicOwner && window.__botaArenaMusicOwner !== this) return;
      if (!this.musicElement.paused && !this.musicElement.ended) return;
      this.syncBackgroundMusic();
    }, 180);
  }

  pauseBackgroundMusic({ reset = false } = {}) {
    if (!this.musicElement) return;
    this.musicPauseIntent = true;
    this.clearMusicResumeTimeout();
    this.musicElement.pause();
    if (reset) {
      try {
        this.musicElement.currentTime = 0;
      } catch (error) {
        // Some browsers reject currentTime changes before metadata is ready.
      }
    }
  }

  pauseOtherBackgroundMusic() {
    if (typeof window === "undefined") return;

    const owner = window.__botaArenaMusicOwner;
    if (
      owner &&
      owner !== this &&
      owner.musicElement !== this.musicElement &&
      typeof owner.pauseBackgroundMusic === "function"
    ) {
      owner.pauseBackgroundMusic({ reset: true });
    }

    const musicElements = window.__botaArenaMusicElements;
    if (!musicElements?.forEach) return;

    musicElements.forEach((music) => {
      if (!music || music === this.musicElement) return;
      music.pause?.();
      try {
        music.currentTime = 0;
      } catch (error) {
        // Some browsers reject currentTime changes before metadata is ready.
      }
    });
  }

  claimBackgroundMusic() {
    if (typeof window === "undefined") return;
    this.clearSharedBackgroundMusicStop();
    this.pauseOtherBackgroundMusic();
    window.__botaArenaMusicOwner = this;
  }

  releaseBackgroundMusic() {
    if (typeof window === "undefined") return;
    this.musicPauseIntent = true;
    if (window.__botaArenaMusicOwner === this) {
      window.__botaArenaMusicOwner = null;
    }
  }

  syncBackgroundMusic() {
    const music = this.setupBackgroundMusic();
    if (!music) return;

    music.volume = this.musicVolume;
    if (!this.soundEnabled) {
      this.pauseBackgroundMusic({ reset: true });
      this.releaseBackgroundMusic();
      return;
    }

    this.claimBackgroundMusic();
    this.musicPauseIntent = false;
    const playResult = music.play?.();
    if (playResult?.catch) {
      playResult.catch(() => this.setupAudioUnlock());
    }
  }

  clearSharedBackgroundMusicStop() {
    if (typeof window === "undefined" || !window.__botaArenaMusicStopTimeout) return;
    window.clearTimeout(window.__botaArenaMusicStopTimeout);
    window.__botaArenaMusicStopTimeout = null;
  }

  scheduleSharedBackgroundMusicStop() {
    if (typeof window === "undefined") return;
    this.clearSharedBackgroundMusicStop();
    const music = this.musicElement;
    window.__botaArenaMusicStopTimeout = window.setTimeout(() => {
      window.__botaArenaMusicStopTimeout = null;
      if (window.__botaArenaMusicOwner || !music) return;
      music.pause?.();
      try {
        music.currentTime = 0;
      } catch (error) {
        // Some browsers reject currentTime changes before metadata is ready.
      }
    }, 900);
  }

  createSampleSfxSources() {
    const sfx = (fileName) => this.resolveAssetPath(`audio/sfx/${fileName}`);

    return {
      attack: [],
      // Sword clanks removed: slash/slashImpact now always use magic synth profiles
      slash: [],
      fireSlash: [sfx("heavy-hit-new.mp3")],
      hit: [sfx("body-hit-new.mp3"), sfx("heavy-hit-new.mp3")],
      slashImpact: [],
      fireImpact: [sfx("heavy-hit-new.mp3"), sfx("smoke-puff-new.mp3")],
      shield: [sfx("shield-block-new.mp3")],
      shieldImpact: [sfx("shield-block-new.mp3")],
      dodge: [sfx("smoke-puff-new.mp3")],
      death: [sfx("heavy-hit-new.mp3")],
    };
  }

  preloadSampleSfx() {
    const sources = new Set(Object.values(this.sampleSfxSources).flat());
    sources.forEach((source) => {
      this.createSampleSfxElement(source);
      this.loadSampleSfxBuffer(source);
    });
  }

  createSampleSfxElement(source) {
    if (!source || typeof Audio === "undefined") return null;
    if (this.sampleSfxElements[source]) return this.sampleSfxElements[source];

    const audio = new Audio(source);
    audio.preload = "auto";
    audio.setAttribute("playsinline", "true");
    audio.load?.();
    this.sampleSfxElements[source] = audio;
    return audio;
  }

  async loadSampleSfxBuffer(source) {
    if (!source || this.sampleSfxBuffers[source]) return this.sampleSfxBuffers[source] || null;
    if (this.sampleSfxBufferPromises[source]) return this.sampleSfxBufferPromises[source];
    if (typeof fetch === "undefined") return null;

    const context = this.ensureAudioContext();
    if (!context?.decodeAudioData) return null;

    this.sampleSfxBufferPromises[source] = fetch(source)
      .then((response) => {
        if (!response.ok) throw new Error(`SFX fetch failed: ${source}`);
        return response.arrayBuffer();
      })
      .then((arrayBuffer) => context.decodeAudioData(arrayBuffer.slice(0)))
      .then((buffer) => {
        this.sampleSfxBuffers[source] = buffer;
        return buffer;
      })
      .catch(() => null);

    return this.sampleSfxBufferPromises[source];
  }

  getSampleSfxSources(kind = "hit") {
    const aliases = {
      projectile: "attack",
    };
    const resolvedKind = aliases[kind] || kind;
    return this.sampleSfxSources[resolvedKind] || null;
  }

  getSampleSfxVolume(kind = "hit") {
    const volumes = {
      attack: 0.34,
      slash: 0.42,
      fireSlash: 0.44,
      hit: 0.46,
      slashImpact: 0.48,
      fireImpact: 0.5,
      shield: 0.42,
      shieldImpact: 0.46,
      dodge: 0.45,
      death: 0.46,
    };

    return volumes[kind] ?? 0.4;
  }

  clampSfxPan(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(-0.42, Math.min(0.42, value));
  }

  getSfxPan(options = {}) {
    if (Number.isFinite(options.pan)) return this.clampSfxPan(options.pan);
    const emitter = options.emitter || options.fighter || null;

    if (Number.isFinite(emitter)) return this.clampSfxPan(emitter);
    if (emitter?.position && typeof emitter.getCollisionBox === "function") {
      const canvasWidth = this.canvas?.width || 1024;
      const centerX = this.getFighterCenterX(emitter);
      return this.clampSfxPan((centerX / canvasWidth) * 2 - 1);
    }
    if (Number.isFinite(emitter?.x)) {
      const canvasWidth = this.canvas?.width || 1024;
      return this.clampSfxPan((emitter.x / canvasWidth) * 2 - 1);
    }

    return this.clampSfxPan((this.random() - 0.5) * 0.28);
  }

  normalizeSfxOptions(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      return { emitter: options || null };
    }
    return options;
  }

  shouldLayerSynthWithSample(kind = "hit") {
    return new Set([
      "slash",
      "fireSlash",
      "slashImpact",
      "fireImpact",
      "shield",
      "shieldImpact",
      "dodge",
      "death",
    ]).has(kind);
  }

  playSampleSfx(kind = "hit", context = null, now = null, options = {}) {
    const sources = this.getSampleSfxSources(kind);
    if (!sources?.length) return false;

    const cursor = this.sampleSfxCursor[kind] || 0;
    const source = sources[cursor % sources.length];
    this.sampleSfxCursor[kind] = cursor + 1;
    const volume = Math.max(0, Math.min(1, this.getSampleSfxVolume(kind)));
    const playbackRate = 0.96 + this.random() * 0.08;
    const pan = this.getSfxPan(options);

    if (context?.state === "running") {
      const buffer = this.sampleSfxBuffers[source];
      if (buffer) {
        try {
          const startedAt = Math.max(context.currentTime, now ?? context.currentTime) + 0.006;
          const sourceNode = context.createBufferSource();
          const gain = context.createGain();
          const compressor = context.createDynamicsCompressor();
          const panNode = context.createStereoPanner?.();
          sourceNode.buffer = buffer;
          sourceNode.playbackRate.setValueAtTime(playbackRate, startedAt);
          gain.gain.setValueAtTime(0.0001, startedAt);
          gain.gain.exponentialRampToValueAtTime(volume, startedAt + 0.006);
          gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + Math.min(0.8, buffer.duration + 0.04));
          compressor.threshold.setValueAtTime(-20, startedAt);
          compressor.knee.setValueAtTime(10, startedAt);
          compressor.ratio.setValueAtTime(5, startedAt);
          compressor.attack.setValueAtTime(0.002, startedAt);
          compressor.release.setValueAtTime(0.08, startedAt);
          sourceNode.connect(gain);
          gain.connect(compressor);
          if (panNode) {
            panNode.pan.setValueAtTime(pan, startedAt);
            compressor.connect(panNode);
            panNode.connect(context.destination);
          } else {
            compressor.connect(context.destination);
          }
          sourceNode.start(startedAt);
          sourceNode.stop(startedAt + Math.min(1.2, buffer.duration + 0.08));
          return true;
        } catch {
          // Fall through to the HTMLAudio fallback below.
        }
      } else {
        this.loadSampleSfxBuffer(source);
      }
    }

    if (typeof Audio === "undefined") return false;

    const baseAudio = this.createSampleSfxElement(source);
    if (!baseAudio) return false;

    const audio = baseAudio.cloneNode(true);
    audio.volume = volume;
    audio.playbackRate = playbackRate;
    audio.currentTime = 0;

    const playResult = audio.play?.();
    playResult?.catch?.(() => undefined);
    return true;
  }

  primeAudioContext(context) {
    if (this.audioPrimed || !context || context.state !== "running") return;

    try {
      const now = context.currentTime;
      const gain = context.createGain();
      const oscillator = context.createOscillator();
      gain.gain.setValueAtTime(0.00001, now);
      oscillator.frequency.setValueAtTime(40, now);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.025);
      this.audioPrimed = true;
    } catch {
      this.audioPrimed = false;
    }
  }

  createNoiseBuffer(context, durationSeconds = 0.14) {
    const sampleRate = context.sampleRate || 44100;
    const length = Math.max(1, Math.floor(sampleRate * durationSeconds));
    const buffer = context.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;

    for (let index = 0; index < length; index++) {
      const white = this.random() * 2 - 1;
      last = last * 0.62 + white * 0.38;
      data[index] = last;
    }

    return buffer;
  }

  envelopeGain(gain, now, peak, attack = 0.01, decay = 0.18, delay = 0) {
    const start = now + Math.max(0, delay);
    const safePeak = Math.max(0.0002, peak);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(safePeak, start + Math.max(0.004, attack));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(attack + 0.018, decay));
    return start;
  }

  connectSfxOutput(context, profile, now, options = {}) {
    const master = context.createGain();
    const filter = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();
    const panNode = context.createStereoPanner?.();

    filter.type = profile.filterType || "lowpass";
    filter.frequency.setValueAtTime(profile.filterFrequency || 2600, now);
    if (profile.filterTo) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(40, profile.filterTo),
        now + (profile.duration || 0.28),
      );
    }
    filter.Q.setValueAtTime(profile.filterQ || 0.8, now);

    compressor.threshold.setValueAtTime(-22, now);
    compressor.knee.setValueAtTime(14, now);
    compressor.ratio.setValueAtTime(6, now);
    compressor.attack.setValueAtTime(0.004, now);
    compressor.release.setValueAtTime(0.12, now);

    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(profile.volume || 0.12, now + 0.012);
    master.gain.exponentialRampToValueAtTime(0.0001, now + (profile.duration || 0.32));

    filter.connect(compressor);
    compressor.connect(master);

    if (panNode) {
      panNode.pan.setValueAtTime(profile.pan ?? this.getSfxPan(options), now);
      master.connect(panNode);
      panNode.connect(context.destination);
    } else {
      master.connect(context.destination);
    }

    return filter;
  }

  playToneLayer(context, output, layer, now, variation = 1) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = now + (layer.delay || 0);
    const duration = layer.duration || 0.18;
    const from = Math.max(24, (layer.from || layer.frequency || 220) * variation);
    const to = Math.max(24, (layer.to || layer.frequency || from) * variation);

    oscillator.type = layer.type || "sine";
    oscillator.frequency.setValueAtTime(from, start);
    if (layer.curve === "linear") {
      oscillator.frequency.linearRampToValueAtTime(to, start + duration);
    } else {
      oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
    }
    if (layer.detune) {
      oscillator.detune.setValueAtTime(layer.detune, start);
    }

    this.envelopeGain(gain, now, layer.gain || 0.1, layer.attack || 0.008, duration, layer.delay || 0);
    oscillator.connect(gain);
    gain.connect(output);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.04);
  }

  playNoiseLayer(context, output, layer, now) {
    const source = context.createBufferSource();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const start = now + (layer.delay || 0);
    const duration = layer.duration || 0.12;

    source.buffer = this.createNoiseBuffer(context, duration + 0.04);
    filter.type = layer.filterType || "bandpass";
    filter.frequency.setValueAtTime(layer.frequency || 1600, start);
    if (layer.frequencyTo) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, layer.frequencyTo), start + duration);
    }
    filter.Q.setValueAtTime(layer.q || 1.2, start);

    this.envelopeGain(gain, now, layer.gain || 0.08, layer.attack || 0.006, duration, layer.delay || 0);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    source.start(start);
    source.stop(start + duration + 0.04);
  }

  getSfxProfile(kind = "hit") {
    const profiles = {
      attack: {
        volume: 0.11,
        duration: 0.22,
        filterFrequency: 2800,
        tones: [
          { type: "triangle", from: 260, to: 620, gain: 0.08, duration: 0.16 },
          { type: "square", from: 96, to: 72, gain: 0.045, duration: 0.11 },
        ],
        noise: [{ frequency: 1300, frequencyTo: 4200, gain: 0.05, duration: 0.11 }],
      },
      bolt: {
        volume: 0.12,
        duration: 0.28,
        filterFrequency: 4300,
        tones: [
          { type: "sawtooth", from: 620, to: 1420, gain: 0.07, duration: 0.2 },
          { type: "triangle", from: 1240, to: 820, gain: 0.035, duration: 0.18, delay: 0.025 },
        ],
        noise: [{ frequency: 3400, gain: 0.045, duration: 0.16 }],
      },
      projectile: {
        volume: 0.13,
        duration: 0.34,
        filterFrequency: 4800,
        tones: [
          { type: "sawtooth", from: 500, to: 1620, gain: 0.075, duration: 0.22 },
          { type: "triangle", from: 150, to: 92, gain: 0.055, duration: 0.2 },
        ],
        noise: [{ frequency: 2200, frequencyTo: 5800, gain: 0.06, duration: 0.18 }],
      },
      fireball: {
        volume: 0.15,
        duration: 0.44,
        filterFrequency: 3600,
        filterTo: 880,
        tones: [
          { type: "sawtooth", from: 118, to: 58, gain: 0.09, duration: 0.34 },
          { type: "triangle", from: 520, to: 1380, gain: 0.06, duration: 0.2 },
        ],
        noise: [
          { filterType: "lowpass", frequency: 1250, frequencyTo: 420, gain: 0.11, duration: 0.32 },
          { filterType: "bandpass", frequency: 4200, gain: 0.035, duration: 0.12 },
        ],
      },
      volley: {
        volume: 0.14,
        duration: 0.42,
        filterFrequency: 5200,
        tones: [
          { type: "square", from: 740, to: 1320, gain: 0.05, duration: 0.12 },
          { type: "square", from: 860, to: 1510, gain: 0.045, duration: 0.12, delay: 0.085 },
          { type: "square", from: 680, to: 1220, gain: 0.045, duration: 0.12, delay: 0.17 },
          { type: "triangle", from: 130, to: 74, gain: 0.045, duration: 0.28 },
        ],
        noise: [{ frequency: 2800, gain: 0.055, duration: 0.28 }],
      },
      slash: {
        volume: 0.14,
        duration: 0.26,
        filterType: "highpass",
        filterFrequency: 720,
        filterTo: 2800,
        tones: [
          { type: "sawtooth", from: 1320, to: 240, gain: 0.075, duration: 0.18 },
          { type: "triangle", from: 2600, to: 880, gain: 0.035, duration: 0.12, delay: 0.018 },
        ],
        noise: [{ filterType: "highpass", frequency: 2400, frequencyTo: 7800, gain: 0.085, duration: 0.13 }],
      },
      fireSlash: {
        volume: 0.16,
        duration: 0.38,
        filterFrequency: 3900,
        tones: [
          { type: "sawtooth", from: 1200, to: 170, gain: 0.08, duration: 0.22 },
          { type: "triangle", from: 140, to: 62, gain: 0.075, duration: 0.28 },
        ],
        noise: [
          { filterType: "highpass", frequency: 2000, frequencyTo: 6200, gain: 0.07, duration: 0.13 },
          { filterType: "lowpass", frequency: 900, gain: 0.08, duration: 0.22, delay: 0.08 },
        ],
      },
      magicAttack: {
        volume: 0.16,
        duration: 0.35,
        filterFrequency: 4500,
        tones: [
          { type: "sine", from: 800, to: 1600, gain: 0.08, duration: 0.25 },
          { type: "sine", from: 1400, to: 2200, gain: 0.04, duration: 0.35, delay: 0.05 },
        ],
        noise: [{ filterType: "highpass", frequency: 4000, gain: 0.02, duration: 0.2 }],
      },
      magicHit: {
        volume: 0.18,
        duration: 0.4,
        filterFrequency: 2800,
        tones: [
          { type: "sine", from: 1100, to: 500, gain: 0.1, duration: 0.2 },
          { type: "triangle", from: 700, to: 300, gain: 0.06, duration: 0.3 },
        ],
      },
      magicImpact: {
        volume: 0.2,
        duration: 0.45,
        filterFrequency: 4500,
        tones: [
          { type: "sine", from: 1500, to: 600, gain: 0.12, duration: 0.25 },
          { type: "triangle", from: 900, to: 300, gain: 0.08, duration: 0.35 },
        ],
      },
      hit: {
        volume: 0.16,
        duration: 0.28,
        filterFrequency: 1900,
        filterTo: 320,
        tones: [
          { type: "square", from: 160, to: 54, gain: 0.11, duration: 0.2 },
          { type: "triangle", from: 82, to: 42, gain: 0.075, duration: 0.24 },
        ],
        noise: [{ filterType: "lowpass", frequency: 900, gain: 0.13, duration: 0.16 }],
      },
      fireImpact: {
        volume: 0.17,
        duration: 0.44,
        filterFrequency: 2200,
        filterTo: 360,
        tones: [
          { type: "sawtooth", from: 130, to: 42, gain: 0.1, duration: 0.34 },
          { type: "triangle", from: 640, to: 160, gain: 0.045, duration: 0.22 },
        ],
        noise: [
          { filterType: "lowpass", frequency: 1250, frequencyTo: 240, gain: 0.14, duration: 0.32 },
          { filterType: "bandpass", frequency: 3200, gain: 0.055, duration: 0.14 },
        ],
      },
      slashImpact: {
        volume: 0.16,
        duration: 0.3,
        filterFrequency: 3600,
        tones: [
          { type: "sawtooth", from: 980, to: 130, gain: 0.075, duration: 0.17 },
          { type: "square", from: 150, to: 58, gain: 0.08, duration: 0.2, delay: 0.025 },
        ],
        noise: [{ filterType: "highpass", frequency: 1800, frequencyTo: 5200, gain: 0.12, duration: 0.13 }],
      },
      shield: {
        volume: 0.13,
        duration: 0.48,
        filterFrequency: 2800,
        tones: [
          { type: "sine", from: 330, to: 520, gain: 0.06, duration: 0.2 },
          { type: "sine", from: 660, to: 990, gain: 0.05, duration: 0.24, delay: 0.045 },
          { type: "triangle", from: 1320, to: 740, gain: 0.035, duration: 0.3, delay: 0.11 },
        ],
        noise: [{ filterType: "bandpass", frequency: 2200, gain: 0.035, duration: 0.18 }],
      },
      shieldImpact: {
        volume: 0.15,
        duration: 0.34,
        filterFrequency: 3300,
        tones: [
          { type: "sine", from: 880, to: 460, gain: 0.07, duration: 0.18 },
          { type: "triangle", from: 1760, to: 1020, gain: 0.035, duration: 0.18, delay: 0.025 },
          { type: "square", from: 120, to: 70, gain: 0.05, duration: 0.16 },
        ],
        noise: [{ filterType: "bandpass", frequency: 2500, gain: 0.075, duration: 0.1 }],
      },
      heal: {
        volume: 0.12,
        duration: 0.56,
        filterFrequency: 5200,
        tones: [
          { type: "sine", from: 420, to: 840, gain: 0.045, duration: 0.18 },
          { type: "sine", from: 630, to: 1260, gain: 0.04, duration: 0.22, delay: 0.08 },
          { type: "triangle", from: 940, to: 1880, gain: 0.032, duration: 0.25, delay: 0.17 },
        ],
        noise: [{ filterType: "highpass", frequency: 3600, gain: 0.025, duration: 0.24 }],
      },
      charge: {
        volume: 0.12,
        duration: 0.46,
        filterFrequency: 3600,
        tones: [
          { type: "sawtooth", from: 92, to: 260, gain: 0.07, duration: 0.34 },
          { type: "triangle", from: 420, to: 980, gain: 0.045, duration: 0.25, delay: 0.07 },
        ],
        noise: [{ filterType: "bandpass", frequency: 700, frequencyTo: 1800, gain: 0.045, duration: 0.28 }],
      },
      dodge: {
        volume: 0.11,
        duration: 0.24,
        filterType: "highpass",
        filterFrequency: 900,
        filterTo: 4800,
        tones: [{ type: "triangle", from: 520, to: 980, gain: 0.035, duration: 0.11 }],
        noise: [{ filterType: "highpass", frequency: 1400, frequencyTo: 6200, gain: 0.09, duration: 0.12 }],
      },
      death: {
        volume: 0.16,
        duration: 0.72,
        filterFrequency: 1300,
        filterTo: 160,
        tones: [
          { type: "sawtooth", from: 180, to: 38, gain: 0.11, duration: 0.58 },
          { type: "triangle", from: 72, to: 34, gain: 0.08, duration: 0.62, delay: 0.04 },
        ],
        noise: [{ filterType: "lowpass", frequency: 760, frequencyTo: 180, gain: 0.11, duration: 0.5 }],
      },
      win: {
        volume: 0.14,
        duration: 0.9,
        filterFrequency: 5600,
        tones: [
          { type: "triangle", from: 392, to: 392, gain: 0.052, duration: 0.15 },
          { type: "triangle", from: 523.25, to: 523.25, gain: 0.052, duration: 0.16, delay: 0.13 },
          { type: "triangle", from: 659.25, to: 659.25, gain: 0.05, duration: 0.18, delay: 0.26 },
          { type: "triangle", from: 784, to: 1046.5, gain: 0.06, duration: 0.34, delay: 0.42 },
          { type: "sine", from: 98, to: 130.8, gain: 0.04, duration: 0.52, delay: 0.1 },
        ],
        noise: [{ filterType: "highpass", frequency: 3600, gain: 0.028, duration: 0.44, delay: 0.22 }],
      },
    };

    return profiles[kind] || profiles.hit;
  }

  playSfx(kind = "hit", options = {}) {
    if (!this.soundEnabled) return;

    const sfxOptions = this.normalizeSfxOptions(options);
    const fighter = sfxOptions.emitter || sfxOptions.fighter || null;
    let targetKind = kind;

    if (fighter && fighter.tactics?.weaponStyle !== "sword") {
      if (kind === "slash" || kind === "attack") targetKind = "magicAttack";
      else if (kind === "slashImpact" || kind === "fireImpact") targetKind = "magicImpact";
      else if (kind === "hit") targetKind = "magicHit";
    }
    kind = targetKind;

    const context = this.ensureAudioContext();
    const now = context?.currentTime ?? Date.now() / 1000;
    const minGapMsByKind = {
      death: 520,
      win: 720,
      fireImpact: 90,
      slashImpact: 70,
      shieldImpact: 70,
      hit: 60,
    };
    const minGapMs = minGapMsByKind[kind] || 34;
    const previousAt = this.lastSfxAt[kind] || -999;
    if ((now - previousAt) * 1000 < minGapMs) return;
    this.lastSfxAt[kind] = now;

    if (!context) {
      this.playSampleSfx(kind, null, null, sfxOptions);
      return;
    }

    if (context.state === "suspended") {
      this.setupAudioUnlock();
      context.resume?.().then?.(() => {
        if (context.state === "running") {
          this.preloadSampleSfx();
          delete this.lastSfxAt[kind];
          this.playSfx(kind, sfxOptions);
        }
      }).catch?.(() => undefined);
      return;
    }

    const hasRealSample = Boolean(this.getSampleSfxSources(kind)?.length);
    const sampleStarted = this.playSampleSfx(kind, context, now, sfxOptions);
    if ((sampleStarted || hasRealSample) && !this.shouldLayerSynthWithSample(kind)) return;

    const profile = this.getSfxProfile(kind);
    const output = this.connectSfxOutput(context, profile, now, sfxOptions);
    const variation = 0.94 + this.random() * 0.12;

    for (const layer of profile.tones || []) {
      this.playToneLayer(context, output, layer, now, variation);
    }
    for (const layer of profile.noise || []) {
      this.playNoiseLayer(context, output, layer, now);
    }
  }

  selectStageConfig(stageConfig) {
    const selectedStageConfig = this.clone(stageConfig);
    const variants = [
      selectedStageConfig.background,
      ...(selectedStageConfig.backgroundVariants || []),
    ].filter((variant) => variant?.imageSrc);

    if (!this.autonomous || variants.length < 2) {
      return selectedStageConfig;
    }

    if (this.stageVariantId) {
      const requestedVariant = variants.find((variant) => variant.id === this.stageVariantId);
      if (requestedVariant) {
        selectedStageConfig.background = this.clone(requestedVariant);
        selectedStageConfig.selectedBackgroundId =
          selectedStageConfig.background.id || selectedStageConfig.background.imageSrc;
        return selectedStageConfig;
      }
    }

    const seed = this.getInitialArenaSeed();
    const selectedIndex = this.hashSeed(`stage:${seed}`) % variants.length;
    selectedStageConfig.background = this.clone(variants[selectedIndex]);
    selectedStageConfig.selectedBackgroundId =
      selectedStageConfig.background.id || selectedStageConfig.background.imageSrc;
    return selectedStageConfig;
  }

  getInitialArenaSeed() {
    if (this.arenaSeed) {
      return String(this.arenaSeed);
    }

    const params = new URLSearchParams(window.location.search);
    return [
      params.get("battle"),
      params.get("battleId"),
      params.get("round"),
      params.get("stage"),
    ]
      .filter(Boolean)
      .join(":") || "arena-preview";
  }

  isCompactArenaViewport() {
    const width =
      this.rootElement?.clientWidth ||
      window.innerWidth ||
      document.documentElement?.clientWidth ||
      1366;
    return width <= 720;
  }

  createFighter(config) {
    const moves = MoveResolver.normalizeMoves(config);
    const defaultMove = moves[0] || config.attack;

    const fighter = new Fighter({
      position: this.clone(config.position),
      mirror: Boolean(config.mirror),
      velocity: this.clone(config.velocity),
      offset: this.clone(config.offset),
      imageSrc: config.imageSrc,
      totalFrames: config.totalFrames,
      frameWidth: config.frameWidth,
      frameHeight: config.frameHeight,
      frameColumns: config.frameColumns,
      frameStart: config.frameStart,
      frameSequence: this.clone(config.frameSequence),
      framesHold: config.framesHold,
      scale: config.scale,
      renderFilter: config.renderFilter || "",
      sprites: this.clone(config.sprites),
      context: this.context,
      canvasElement: this.canvas,
      gravityValue: this.stage.gravity,
      floorY: this.stage.floorY,
      movementBounds: this.stage.fighterBounds,
      bodySize: this.clone(config.bodySize),
      hurtboxes: this.clone(config.hurtboxes),
      collisionBox: this.clone(config.collisionBox),
      attackBox: {
        offset: this.clone(defaultMove.hitbox.offset),
        width: defaultMove.hitbox.width,
        height: defaultMove.hitbox.height,
      },
    });

    fighter.playerId = config.id;
    fighter.displayName = config.name;
    fighter.movement = config.movement;
    fighter.moves = moves;
    fighter.attackConfig = defaultMove;
    fighter.healthSelector = config.healthSelector;
    fighter.renderedHealth = fighter.health;
    fighter.ai = this.createDefaultAiProfile();
    fighter.mechanics = config.mechanics || "classic";
    fighter.tactics = this.clone(config.tactics) || {};
    fighter.maxEnergy = fighter.tactics.maxEnergy || 6;
    fighter.energy = fighter.tactics.initialEnergy ?? Math.min(3, fighter.maxEnergy);
    fighter.energyRegen = fighter.tactics.energyRegen || 2;
    fighter.cooldowns = {};
    fighter.shield = 0;
    fighter.speedStat = fighter.tactics.speed || 50;
    fighter.mascotAvatar = config.avatarSrc || config.imageSrc;
    fighter.renderFilter = config.renderFilter || "";
    fighter.damageFlashUntil = 0;
    fighter.shieldVisibleUntil = 0;

    return fighter;
  }

  applyMascotLoadout(fighterConfigs) {
    if (!fighterConfigs.some((config) => config.mechanics === "mascot_tactics")) return;

    const seed = this.getInitialArenaSeed();
    const hash = this.hashSeed(`mascot-loadout:${seed}`);
    const families = this.getMascotLoadoutFamilies();
    const family = families[hash % families.length] || families[0];

    if (family?.kit) {
      fighterConfigs.forEach((config, index) => {
        this.applyMascotCharacterKit(config, family.kit, index);
      });
      return;
    }

    // Always use "punch" style for mascots — swords produce clank SFX which
    // do not fit the magical BOTA arena aesthetic.
    const style = "punch";
    const variants = this.getMascotVariants();
    const leftVariant = variants[hash % variants.length];
    const rightVariant = variants[Math.floor(hash / variants.length + 2) % variants.length] || variants[1];
    const compact = this.isCompactArenaViewport();
    const botScale = compact ? 1.05 : 1.09;
    const botOffset = compact ? { x: 134, y: 108 } : { x: 138, y: 114 };

    fighterConfigs.forEach((config, index) => {
      const variant = index === 0 ? leftVariant : rightVariant;
      const sheet =
        style === "sword"
          ? "image/mascots/actions/bantah-sword-sheet.png"
          : index === 0
            ? "image/mascots/actions/bantah-punch-sheet.png"
            : "image/mascots/actions/bantah-rival-punch-sheet.png";
      const deathSheet =
        style === "sword"
          ? "image/mascots/actions/bantah-sword-death-sheet.png"
          : index === 0
            ? "image/mascots/actions/bantah-punch-death-sheet.png"
            : "image/mascots/actions/bantah-rival-punch-death-sheet.png";
      const fallbackAvatar =
        style === "sword"
          ? "image/mascots/actions/bantah-sword-avatar-portrait.png"
          : index === 0
            ? "image/mascots/actions/bantah-punch-avatar-portrait.png"
            : "image/mascots/actions/bantah-rival-punch-avatar-portrait.png";

      config.imageSrc = sheet;
      config.avatarSrc = variant.avatarSrc || fallbackAvatar;
      config.renderFilter = variant.filter || "";
      config.scale = botScale;
      config.offset = this.clone(botOffset);
      config.tactics = {
        ...(config.tactics || {}),
        weaponStyle: style,
        projectileColor: variant.projectileColor,
        shieldColor: variant.shieldColor,
        damageColor: "#ff372f",
        variantName: variant.name,
        shadowOffsetY: compact ? -3 : -5,
        shadowScaleX: 0.29,
        shadowScaleY: 0.038,
      };

      for (const [spriteName, sprite] of Object.entries(config.sprites || {})) {
        sprite.imageSrc = sheet;
        if (spriteName === "death") {
          sprite.imageSrc = deathSheet;
          sprite.totalFrames = 8;
          sprite.frameColumns = 8;
          sprite.frameStart = 0;
          sprite.frameSequence = null;
          sprite.framesHold = 6;
        }
      }
    });
  }

  getMascotLoadoutFamilies() {
    return [{ id: "bantah-bots" }];
  }

  applyMascotCharacterKit(config, kit, index) {
    const side = kit.sides?.[index] || {};
    const compact = this.isCompactArenaViewport();
    const scale = compact && kit.mobileScale ? kit.mobileScale : kit.scale;
    const offset = compact && kit.mobileOffset ? kit.mobileOffset : kit.offset;
    const attackOffset = index === 0 ? kit.attackHitbox.leftOffset : kit.attackHitbox.rightOffset;
    const attackHitbox = {
      offset: this.clone(attackOffset),
      width: kit.attackHitbox.width,
      height: kit.attackHitbox.height,
    };

    config.name = side.name || kit.name || config.name;
    config.position = {
      ...(config.position || {}),
      y: kit.positionY || config.position?.y || 390,
    };
    config.offset = this.clone(offset);
    config.imageSrc = kit.imageSrc;
    config.avatarSrc = side.avatarSrc || kit.avatarSrc;
    config.renderFilter = side.filter || kit.filter || "";
    config.totalFrames = kit.totalFrames;
    config.frameWidth = kit.frameWidth;
    config.frameHeight = kit.frameHeight;
    config.frameColumns = kit.frameColumns;
    config.frameStart = 0;
    config.frameSequence = null;
    config.framesHold = kit.framesHold || 8;
    config.scale = scale;
    config.bodySize = this.clone(kit.bodySize);
    config.hurtboxes = this.clone(kit.hurtboxes);
    config.collisionBox = this.clone(kit.collisionBox);
    config.attack = {
      damage: kit.moves?.damage || 16,
      hitFrame: kit.moves?.hitFrame || 5,
      hitbox: this.clone(attackHitbox),
    };
    config.moves = [
      {
        id: `${kit.name || "mascot"}_primary`.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        name: kit.moves?.name || "Signal Strike",
        command: ["attack"],
        inputWindowMs: 220,
        priority: 10,
        sprite: "attack",
        damage: kit.moves?.damage || 16,
        hitFrame: kit.moves?.hitFrame || 5,
        hitbox: this.clone(attackHitbox),
      },
    ];
    config.tactics = {
      ...(config.tactics || {}),
      ...(kit.tactics || {}),
    };
    config.sprites = this.buildMascotStripSprites(kit);
  }

  buildMascotStripSprites(kit) {
    return Object.fromEntries(
      Object.entries(kit.sprites || {}).map(([name, sprite]) => [
        name,
        {
          imageSrc: sprite.imageSrc,
          totalFrames: sprite.totalFrames || kit.totalFrames || 8,
          frameWidth: sprite.frameWidth || kit.frameWidth || 512,
          frameHeight: sprite.frameHeight || kit.frameHeight || 512,
          frameColumns: sprite.frameColumns || kit.frameColumns || 8,
          frameStart: sprite.frameStart || 0,
          frameSequence: this.clone(sprite.frameSequence) || null,
          framesHold: sprite.framesHold || kit.framesHold || 8,
        },
      ]),
    );
  }

  getMascotVariants() {
    return [
      {
        name: "orange",
        avatarSrc: "image/mascots/actions/bantah-punch-avatar-portrait.png",
        filter: "",
        projectileColor: "#ffb329",
        shieldColor: "#9cff35",
      },
      {
        name: "emerald",
        avatarSrc: "image/mascots/actions/bantah-avatar-emerald-portrait.png",
        filter: "hue-rotate(64deg) saturate(1.35) brightness(0.98)",
        projectileColor: "#28f2bc",
        shieldColor: "#5cffd6",
      },
      {
        name: "purple",
        avatarSrc: "image/mascots/actions/bantah-avatar-purple-portrait.png",
        filter: "hue-rotate(246deg) saturate(1.28) brightness(0.94)",
        projectileColor: "#c278ff",
        shieldColor: "#b58cff",
      },
      {
        name: "ruby",
        avatarSrc: "image/mascots/actions/bantah-avatar-red-portrait.png",
        filter: "hue-rotate(322deg) saturate(1.55) brightness(0.96)",
        projectileColor: "#ff4d4d",
        shieldColor: "#ff7d8f",
      },
      {
        name: "silver",
        avatarSrc: "image/mascots/actions/bantah-avatar-silver-portrait.png",
        filter: "grayscale(0.78) saturate(0.82) brightness(1.16)",
        projectileColor: "#c9f0ff",
        shieldColor: "#e8f5ff",
      },
      {
        name: "rival",
        avatarSrc: "image/mascots/actions/bantah-rival-punch-avatar-portrait.png",
        filter: "hue-rotate(172deg) saturate(1.18) brightness(0.98)",
        projectileColor: "#2ee7ff",
        shieldColor: "#47e6ff",
      },
    ];
  }

  createDefaultAiProfile() {
    return {
      aggression: 50,
      damageMultiplier: 0.22,
      speedMultiplier: 1,
      cooldownMs: 900,
      preferredRange: 142,
      nextAttackAt: 0,
      nextJumpAt: 0,
      nextRetreatAt: 0,
      retreatUntil: 0,
      burstUntil: 0,
    };
  }

  hashSeed(seed) {
    const input = String(seed || "arena");
    let hash = 2166136261;
    for (let index = 0; index < input.length; index++) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) || 1;
  }

  random() {
    this.rngState = (this.rngState + 0x6d2b79f5) | 0;
    let value = this.rngState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  getArenaRngSeed(state) {
    return [
      state.battleId,
      state.startsAt || state.endsAt || "",
      state.left?.id || "",
      state.right?.id || "",
    ].join(":");
  }

  setArenaRngSeed(seed) {
    if (!seed || seed === this.arenaRngSeed) return false;
    this.arenaRngSeed = seed;
    this.rngState = this.hashSeed(seed);
    return true;
  }

  resetArenaAiSchedule() {
    if (this.mechanics === "mascot_tactics") {
      this.initializeMascotTactics();
      return;
    }

    const baseTime = this.now();
    this.fighters.forEach((fighter, index) => {
      fighter.ai = {
        ...this.createDefaultAiProfile(),
        ...fighter.ai,
        nextAttackAt: baseTime + 240 + index * 120 + this.random() * 460,
        nextJumpAt: baseTime + 1_200 + this.random() * 2_400,
        nextRetreatAt: baseTime + 900 + this.random() * 1_400,
        retreatUntil: 0,
        burstUntil: 0,
      };
    });
  }

  createBindings(fighterConfigs) {
    return fighterConfigs.reduce((bindings, fighter) => {
      bindings[fighter.id] = fighter.controls;
      return bindings;
    }, {});
  }

  animate() {
    if (this.destroyed) return;

    this.clear();
    this.background.update();

    for (const decoration of this.decorations) {
      decoration.update();
    }

    if (this.stage.overlay) {
      this.context.fillStyle = this.stage.overlay;
      this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    if (this.mechanics === "mascot_tactics") {
      this.updateMascotFloat();
      this.drawMascotGroundShadows();
      this.updateSpriteFx("behind");
    }

    for (const fighter of this.fighters) {
      fighter.update();
    }

    if (this.mechanics === "mascot_tactics") {
      this.drawMascotShields();
      this.updateProjectiles();
      this.updateSpriteFx("front");
      this.updateFloatingFx();
      this.drawFighterNameBadges();
    } else {
      this.resolveBodyCollision();
    }

    for (const fighter of this.fighters) {
      this.applyInput(fighter);
    }

    if (this.mechanics === "mascot_tactics") {
      this.updateMascotTactics();
    } else {
      this.resolveAttacks();
    }
    this.round.update();

    this.animationFrameId = window.requestAnimationFrame(() => this.animate());
  }

  clear() {
    this.context.fillStyle = "black";
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  applyInput(fighter) {
    if (this.mechanics === "mascot_tactics") {
      fighter.velocity.x = 0;
      if (!fighter.mascotMotion) {
        fighter.setMovementState("stand");
      }
      return;
    }

    if (this.autonomous) {
      this.applyAutonomousInput(fighter);
      return;
    }

    if (!fighter.canControl() || this.round.finished) {
      fighter.velocity.x = 0;
      return;
    }

    fighter.velocity.x = 0;

    const lastHorizontal = this.input.getLastHorizontal(fighter.playerId);
    const movingLeft =
      this.input.isPressed(fighter.playerId, "left") && lastHorizontal === "left";
    const movingRight =
      this.input.isPressed(fighter.playerId, "right") && lastHorizontal === "right";

    if (movingLeft) {
      fighter.velocity.x = -fighter.movement.speed;
      fighter.setMovementState("walk");
    } else if (movingRight) {
      fighter.velocity.x = fighter.movement.speed;
      fighter.setMovementState("walk");
    } else {
      fighter.setMovementState("stand");
    }

    if (this.input.consumePress(fighter.playerId, "jump") && fighter.isGrounded()) {
      fighter.velocity.y = fighter.movement.jumpVelocity;
      fighter.setMovementState("jump");
    }

    const move = this.moveResolver.getMove(fighter, this.input);
    if (move && fighter.canStartMove()) {
      if (fighter.startMove(move)) this.playSfx("attack", fighter);
    }

    if (fighter.velocity.y < 0) {
      fighter.setMovementState("jump");
    } else if (fighter.velocity.y > 0) {
      fighter.setMovementState("fall");
    }
  }

  applyAutonomousInput(fighter) {
    if (!fighter.canControl() || this.round.finished) {
      fighter.velocity.x = 0;
      return;
    }

    const target = this.getOpponent(fighter);
    if (!target || target.health <= 0) {
      fighter.velocity.x = 0;
      fighter.setMovementState("stand");
      return;
    }

    const now = this.now();
    const ownCenter = this.getFighterCenterX(fighter);
    const targetCenter = this.getFighterCenterX(target);
    const direction = targetCenter >= ownCenter ? 1 : -1;
    const distance = Math.abs(targetCenter - ownCenter);
    const ai = fighter.ai || this.createDefaultAiProfile();
    fighter.ai = ai;

    const isBursting = ai.burstUntil > now;
    const speedMultiplier = (ai.speedMultiplier || 1) * (isBursting ? 1.18 : 1);
    const speed = Math.max(1, fighter.movement.speed * speedMultiplier);
    const preferredRange = ai.preferredRange || 142;

    if (ai.retreatUntil > now) {
      fighter.velocity.x = -direction * speed * 0.65;
      fighter.setMovementState("walk");
    } else if (distance > preferredRange) {
      fighter.velocity.x = direction * speed;
      fighter.setMovementState("walk");
    } else if (distance < 55 && now >= ai.nextRetreatAt) {
      ai.retreatUntil = now + 260;
      ai.nextRetreatAt = now + 1_700 + this.random() * 1_000;
      fighter.velocity.x = -direction * speed * 0.65;
      fighter.setMovementState("walk");
    } else {
      fighter.velocity.x = 0;
      fighter.setMovementState("stand");
    }

    if (distance <= preferredRange + 36 && now >= ai.nextAttackAt) {
      const move = this.chooseAutonomousMove(fighter, distance);
      if (move && fighter.startMove(move)) {
        this.playSfx("attack", fighter);
        const aggressionDelay = Math.max(0, 50 - (ai.aggression || 50)) * 8;
        ai.nextAttackAt = now + (ai.cooldownMs || 900) + aggressionDelay + this.random() * 260;
      }
    }

    if (fighter.isGrounded() && now >= ai.nextJumpAt && this.random() < 0.0025) {
      fighter.velocity.y = fighter.movement.jumpVelocity * 0.82;
      fighter.setMovementState("jump");
      ai.nextJumpAt = now + 2_600 + this.random() * 2_400;
    }
  }

  chooseAutonomousMove(fighter, distance) {
    const moves = fighter.moves || [];
    const forward = moves.find((move) => move.id === "forward_strike");
    const basic = moves.find((move) => move.id === "standing_punch") || moves[0];
    if (distance > 95 && forward) return forward;
    return basic;
  }

  hasGrenadeTool(actor) {
    if (!this.arenaState) return false;
    const sideState = this.fighters.indexOf(actor) === 0 ? this.arenaState.left : this.arenaState.right;
    if (!sideState || !sideState.loadoutTools) return false;
    return sideState.loadoutTools.some(t => String(t.name || "").toLowerCase().includes("grenade") || String(t.rarity || "").toUpperCase() === "EPIC");
  }

  getOpponent(fighter) {
    return this.fighters.find((candidate) => candidate !== fighter) || null;
  }

  getFighterCenterX(fighter) {
    const box = fighter.getCollisionBox();
    return box.position.x + box.width / 2;
  }

  now() {
    return window.performance?.now() || Date.now();
  }

  updateMascotTactics() {
    if (!this.turnState || this.round.finished || this.projectiles.length > 0) return;

    const now = this.now();
    if (now < this.turnState.nextTurnAt) return;

    const actorIndex = this.chooseMascotActorIndex();
    const actor = this.fighters[actorIndex];
    const defender = this.fighters.find((fighter) => fighter !== actor);

    this.turnState.cursor += 1;
    this.turnState.turnNumber += 1;

    if (!actor || !defender || actor.health <= 0 || defender.health <= 0) return;

    this.tickMascotCooldowns(actor);
    actor.energy = Math.min(actor.maxEnergy || 6, (actor.energy || 0) + (actor.energyRegen || 2));
    this.updateEnergyHud(actor);

    const action = this.chooseMascotAction(actor, defender);
    this.performMascotAction(actor, defender, action);

    if (this.turnState.lastActorIndex === actorIndex) {
      this.turnState.repeatedActorCount += 1;
    } else {
      this.turnState.repeatedActorCount = 0;
    }
    this.turnState.lastActorIndex = actorIndex;
    this.turnState.nextTurnAt = now + this.getMascotActionDelay(actor, action);
  }

  chooseMascotActorIndex() {
    const state = this.turnState || {};
    const alive = (state.order || [])
      .map((index) => ({ index, fighter: this.fighters[index] }))
      .filter(({ fighter }) => fighter && fighter.health > 0 && !fighter.dead);
    if (!alive.length) return 0;

    const previous = alive.find(({ index }) => index === state.lastActorIndex);
    const previousCanChain =
      previous &&
      state.repeatedActorCount < 1 &&
      (previous.fighter.energy || 0) >= 2 &&
      this.random() < 0.16 + Math.min(0.18, (state.chaos || 1) * 0.08);
    if (previousCanChain) {
      return previous.index;
    }

    let total = 0;
    const weighted = alive.map(({ index, fighter }) => {
      const energy = fighter.energy || 0;
      const maxEnergy = fighter.maxEnergy || 6;
      const speed = fighter.speedStat || fighter.tactics?.speed || 50;
      const woundedBoost = fighter.health < 42 ? 1.2 : 1;
      const previousPenalty = index === state.lastActorIndex ? 0.42 : 1;
      const tempoNoise = 0.66 + this.random() * (state.chaos || 1.1);
      const weight =
        Math.max(0.1, previousPenalty) *
        woundedBoost *
        tempoNoise *
        (0.72 + speed / 100) *
        (0.78 + energy / Math.max(1, maxEnergy * 1.65));
      total += weight;
      return { index, weight };
    });

    let pick = this.random() * total;
    for (const entry of weighted) {
      pick -= entry.weight;
      if (pick <= 0) return entry.index;
    }
    return weighted[0]?.index || 0;
  }

  getMascotActionDelay(actor, action) {
    const speed = actor?.speedStat || actor?.tactics?.speed || 50;
    const chaos = this.turnState?.chaos || 1;
    const baseByAction = {
      charge: 520,
      grenade: 800,
      shield: 660,
      repair: 780,
      bolt: 600,
      slash: 540,
      fireball: 740,
      volley: 820,
      fireSlash: 760,
    };
    const base = baseByAction[action] || 680;
    const speedCut = Math.min(170, speed * 1.4);
    const jitter = (this.random() - 0.38) * 360 * chaos;
    return Math.max(360, Math.round(base - speedCut + jitter));
  }

  tickMascotCooldowns(fighter) {
    const next = {};
    for (const [key, value] of Object.entries(fighter.cooldowns || {})) {
      const remaining = Number(value) - 1;
      if (remaining > 0) next[key] = remaining;
    }
    fighter.cooldowns = next;
  }

  chooseMascotAction(actor, defender) {
    const healthRatio = actor.health / 100;
    const energy = actor.energy || 0;
    const cooldowns = actor.cooldowns || {};
    const defenderShield = defender.shield || 0;
    const usesSword = actor.tactics?.weaponStyle === "sword";
    const primaryAttack = usesSword ? "slash" : "grenade";
    const heavyAttack = usesSword ? "fireSlash" : (this.random() < 0.48 ? "fireball" : "volley");
    const chaos = this.turnState?.chaos || 1;
    const roll = this.random();

    if (this.hasGrenadeTool(actor) && energy >= 3 && !cooldowns.grenade && roll < 0.25) return "grenade";
    if (healthRatio < 0.3 && energy >= 4 && !cooldowns.heavy && roll < 0.42) return heavyAttack;
    if (healthRatio < 0.36 && energy >= 3 && !cooldowns.repair && roll < 0.72) return "repair";
    if ((healthRatio < 0.55 || roll < 0.12 + chaos * 0.07 || defenderShield > 30) && energy >= 2 && !cooldowns.shield) {
      return "shield";
    }
    if (energy >= 4 && !cooldowns.heavy && (defenderShield < 25 || this.random() < 0.74)) {
      return heavyAttack;
    }
    if (!usesSword && energy >= 4 && !cooldowns.fireball && this.random() < 0.16 + chaos * 0.08) {
      return "fireball";
    }
    if (energy <= 1 && this.random() < 0.55) return "charge";
    if (energy >= 2 && !cooldowns.shield && this.random() < 0.08) return "shield";
    if (energy >= 1) return primaryAttack;
    return "charge";
  }

  performMascotAction(actor, defender, action) {
    this.startMascotMotion(actor, defender, action);

    switch (action) {
      case "shield":
        actor.energy = Math.max(0, (actor.energy || 0) - 2);
        actor.shield = Math.min(70, (actor.shield || 0) + 34);
        actor.shieldVisibleUntil = this.now() + 1_250;
        actor.cooldowns.shield = 3;
        this.spawnSpriteFx("water", this.getMascotCore(actor).x, this.getMascotCore(actor).y + 24, {
          scale: 0.64,
          composite: "lighter",
        });
        this.spawnFloatingFx(actor, "SHIELD", actor.tactics?.shieldColor || "#9cff35");
        this.updateEnergyHud(actor);
        this.playSfx("shield", actor);
        return;

      case "grenade":
        actor.energy = Math.max(0, (actor.energy || 0) - 1);
        actor.cooldowns.grenade = 0;
        this.spawnProjectile(actor, defender, {
          kind: action,
          damage: 18,
          color: "#4ade80",
          radius: 12,
          duration: 620,
        });
        this.updateEnergyHud(actor);
        this.playSfx("hit", actor);
        return;

      case "repair":
        actor.energy = Math.max(0, (actor.energy || 0) - 3);
        actor.health = Math.min(100, actor.health + 14);
        actor.cooldowns.repair = 4;
        this.updateHealthBar(actor);
        this.spawnSpriteFx("water", this.getMascotCore(actor).x, this.getMascotCore(actor).y + 28, {
          scale: 0.58,
          composite: "lighter",
        });
        this.spawnFloatingFx(actor, "+REPAIR", "#7cffd4");
        this.updateEnergyHud(actor);
        this.playSfx("heal", actor);
        return;

      case "fireball":
      case "volley":
      case "fireSlash":
        actor.energy = Math.max(0, (actor.energy || 0) - 4);
        actor.cooldowns.heavy = 3;
        if (action === "fireball") actor.cooldowns.fireball = 2;
        this.spawnProjectile(actor, defender, {
          kind: action,
          damage: action === "fireSlash" ? 22 : action === "fireball" ? 24 : 20,
          color: action === "fireball" ? "#ff8a1f" : actor.tactics?.projectileColor || "#ffe45c",
          radius: action === "fireSlash" ? 12 : action === "fireball" ? 17 : 15,
          duration: action === "fireSlash" ? 360 : action === "fireball" ? 460 : 520,
        });
        this.updateEnergyHud(actor);
        this.playSfx(action, actor);
        return;

      case "charge":
        actor.energy = Math.min(actor.maxEnergy || 6, (actor.energy || 0) + 2);
        this.spawnSpriteFx("smokeDash", this.getMascotCore(actor).x, this.getMascotCore(actor).y + 62, {
          scale: 0.48,
          layer: "behind",
          alpha: 0.72,
        });
        this.spawnFloatingFx(actor, "+ENERGY", "#ffffff");
        this.updateEnergyHud(actor);
        this.playSfx("charge", actor);
        return;

      case "bolt":
      case "slash":
      default:
        actor.energy = Math.max(0, (actor.energy || 0) - 1);
        this.spawnProjectile(actor, defender, {
          kind: action === "slash" ? "slash" : "bolt",
          damage: action === "slash" ? 13 : 11,
          color: actor.tactics?.projectileColor || "#9cff35",
          radius: action === "slash" ? 9 : 10,
          duration: action === "slash" ? 300 : 430,
        });
        this.updateEnergyHud(actor);
        this.playSfx(action === "slash" ? "slash" : "bolt", actor);
    }
  }

  spawnSpriteFx(kind, x, y, options = {}) {
    const presets = {
      flame: {
        image: this.vfxImages.flame,
        frameWidth: 192,
        frameHeight: 192,
        totalFrames: 16,
        duration: 520,
        scale: 0.8,
        layer: "front",
      },
      water: {
        image: this.vfxImages.water,
        frameWidth: 192,
        frameHeight: 192,
        totalFrames: 14,
        duration: 460,
        scale: 0.72,
        layer: "front",
      },
      smokeImpact: {
        image: this.vfxImages.smokeImpact,
        frameWidth: 192,
        frameHeight: 192,
        totalFrames: 16,
        duration: 540,
        scale: 0.72,
        layer: "front",
      },
      smokeDash: {
        image: this.vfxImages.smokeDash,
        frameWidth: 160,
        frameHeight: 160,
        totalFrames: 12,
        duration: 420,
        scale: 0.62,
        layer: "behind",
      },
    };
    const preset = presets[kind];
    if (!preset?.image) return;

    this.spriteFx.push({
      ...preset,
      ...options,
      kind,
      x,
      y,
      startedAt: this.now(),
    });
  }

  updateSpriteFx(layer = "front") {
    if (!this.spriteFx.length) return;

    const now = this.now();
    this.spriteFx = this.spriteFx.filter((fx) => {
      if (fx.layer !== layer) return true;

      const progress = Math.min(1, (now - fx.startedAt) / fx.duration);
      if (!fx.image?.complete || !fx.image.width) return progress < 1;

      const columns = Math.max(1, Math.floor(fx.image.width / fx.frameWidth));
      const frame = Math.min(fx.totalFrames - 1, Math.floor(progress * fx.totalFrames));
      const sourceX = (frame % columns) * fx.frameWidth;
      const sourceY = Math.floor(frame / columns) * fx.frameHeight;
      const width = fx.frameWidth * (fx.scale || 1);
      const height = fx.frameHeight * (fx.scale || 1);

      this.context.save();
      this.context.globalAlpha = fx.alpha ?? (1 - Math.max(0, progress - 0.72) / 0.28);
      this.context.globalCompositeOperation = fx.composite || "source-over";

      if (fx.mirror) {
        this.context.translate(fx.x + width / 2, fx.y - height / 2);
        this.context.scale(-1, 1);
        this.context.drawImage(
          fx.image,
          sourceX,
          sourceY,
          fx.frameWidth,
          fx.frameHeight,
          -width / 2,
          -height / 2,
          width,
          height,
        );
      } else {
        this.context.drawImage(
          fx.image,
          sourceX,
          sourceY,
          fx.frameWidth,
          fx.frameHeight,
          fx.x - width / 2,
          fx.y - height / 2,
          width,
          height,
        );
      }

      this.context.restore();
      return progress < 1;
    });
  }

  startMascotMotion(actor, defender, action) {
    if (!actor) return;

    const actorCore = this.getMascotCore(actor);
    const defenderCore = defender ? this.getMascotCore(defender) : actorCore;
    const direction = defenderCore.x >= actorCore.x ? 1 : -1;

    if (action === "bolt" || action === "volley" || action === "fireball" || action === "slash" || action === "fireSlash") {
      const isSwordAction = action === "slash" || action === "fireSlash";
      const isHeavyAction = action === "volley" || action === "fireball" || action === "fireSlash";
      actor.mascotMotion = {
        kind: "lunge",
        direction,
        reach: isSwordAction ? (isHeavyAction ? 92 : 76) : (isHeavyAction ? 64 : 48),
        homeX: actor.homeX ?? actor.position.x,
        startedAt: this.now(),
        duration: isSwordAction ? (isHeavyAction ? 520 : 420) : (isHeavyAction ? 680 : 560),
      };
      this.spawnSpriteFx("smokeDash", actorCore.x - direction * 38, actorCore.y + 66, {
        mirror: direction < 0,
        layer: "behind",
        scale: isHeavyAction ? 0.58 : 0.5,
        alpha: 0.72,
      });
      actor.setState("attack", { force: true });
      return;
    }

    actor.mascotMotion = {
      kind: "hop",
      homeX: actor.homeX ?? actor.position.x,
      startedAt: this.now(),
      duration: action === "charge" ? 420 : 500,
      lift: action === "charge" ? 12 : 18,
      attackAtPeak: action === "shield",
    };
    actor.setMovementState("jump");
  }

  spawnProjectile(attacker, defender, config) {
    const from = this.getMascotCore(attacker);
    const to = this.getMascotCore(defender);
    const direction = to.x >= from.x ? 1 : -1;
    const launchKind =
      config.kind === "fireball" || config.kind === "volley" || config.kind === "fireSlash"
        ? "flame"
        : "smokeDash";
    this.spawnSpriteFx(launchKind, from.x + direction * 64, from.y + 8, {
      mirror: direction < 0,
      scale: launchKind === "flame" ? 0.42 : 0.34,
      layer: launchKind === "flame" ? "front" : "behind",
      alpha: launchKind === "flame" ? 0.68 : 0.56,
      composite: launchKind === "flame" ? "lighter" : "source-over",
    });

    this.projectiles.push({
      ...config,
      attacker,
      defender,
      from: { x: from.x + direction * 70, y: from.y - 12 },
      to: { x: to.x - direction * 76, y: to.y - 8 },
      direction,
      startedAt: this.now(),
      hit: false,
    });
  }

  updateProjectiles() {
    if (!this.projectiles.length) return;

    const now = this.now();
    this.projectiles = this.projectiles.filter((projectile) => {
      const progress = Math.min(1, (now - projectile.startedAt) / projectile.duration);
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      const x = projectile.from.x + (projectile.to.x - projectile.from.x) * eased;
      const y =
        projectile.from.y +
        (projectile.to.y - projectile.from.y) * eased -
        Math.sin(progress * Math.PI) * (projectile.kind === "grenade" ? 80 : 34);

      this.drawProjectile(projectile, x, y, progress);

      if (progress >= 1 && !projectile.hit) {
        projectile.hit = true;
        this.resolveProjectileImpact(projectile);
        return false;
      }

      return true;
    });
  }

  drawGrenadeProjectile(projectile, x, y, progress) {
    const context = this.context;
    context.save();
    context.translate(x, y);
    context.rotate(progress * Math.PI * 12);
    context.fillStyle = "#3f3f46";
    context.shadowColor = "#4ade80";
    context.shadowBlur = 10;
    context.beginPath();
    context.roundRect(-8, -12, 16, 24, 4);
    context.fill();
    context.fillStyle = "#22c55e";
    context.fillRect(-8, -2, 16, 4);
    context.fillStyle = "#dc2626";
    context.beginPath();
    context.arc(0, -12, 3, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  drawProjectile(projectile, x, y, progress) {
    if (projectile.kind === "grenade") {
      this.drawGrenadeProjectile(projectile, x, y, progress);
      return;
    }
    if (projectile.kind === "slash" || projectile.kind === "fireSlash") {
      this.drawSlashProjectile(projectile, x, y, progress);
      return;
    }
    if (projectile.kind === "fireball" || projectile.kind === "volley") {
      this.drawFireballProjectile(projectile, x, y, progress);
      return;
    }

    const context = this.context;
    const radius = projectile.radius || 10;
    const pulse = Math.sin(progress * Math.PI * 6) * 2;

    context.save();
    context.globalCompositeOperation = "lighter";
    context.shadowColor = projectile.color;
    context.shadowBlur = 18;
    const gradient = context.createRadialGradient(x, y, 1, x, y, radius + 10);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.35, projectile.color);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius + pulse, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = "rgba(255,255,255,0.85)";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(x, y, Math.max(4, radius * 0.48), 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  drawFireballProjectile(projectile, x, y, progress) {
    const context = this.context;
    const direction = projectile.direction || 1;
    const radius = projectile.radius || 16;
    const pulse = Math.sin(progress * Math.PI * 8) * 2.2;
    const tail = 28 + Math.sin(progress * Math.PI) * 16;

    context.save();
    context.translate(x, y);
    context.scale(direction, 1);
    context.globalCompositeOperation = "lighter";
    context.shadowColor = "#ff6a1c";
    context.shadowBlur = 24;

    const tailGradient = context.createLinearGradient(-tail - radius, 0, radius, 0);
    tailGradient.addColorStop(0, "rgba(255, 46, 16, 0)");
    tailGradient.addColorStop(0.36, "rgba(255, 66, 16, 0.62)");
    tailGradient.addColorStop(1, "rgba(255, 241, 126, 0.92)");
    context.fillStyle = tailGradient;
    context.beginPath();
    context.ellipse(-tail * 0.42, 1, tail, radius * 0.74, -0.04, 0, Math.PI * 2);
    context.fill();

    const coreGradient = context.createRadialGradient(0, 0, 2, 0, 0, radius + 12);
    coreGradient.addColorStop(0, "#ffffff");
    coreGradient.addColorStop(0.26, "#fff39b");
    coreGradient.addColorStop(0.58, projectile.color || "#ff8a1f");
    coreGradient.addColorStop(1, "rgba(255, 51, 13, 0)");
    context.fillStyle = coreGradient;
    context.beginPath();
    context.arc(0, 0, radius + pulse, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = "rgba(255, 250, 186, 0.9)";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(0, 0, Math.max(5, radius * 0.42), 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  drawSlashProjectile(projectile, x, y, progress) {
    const context = this.context;
    const isFire = projectile.kind === "fireSlash";
    const direction = projectile.direction || 1;
    const slashColor = isFire ? "#ff9d1e" : projectile.color || "#f7fbff";
    const coreColor = isFire ? "#fff0a8" : "#ffffff";
    const sweep = 20 + progress * 18;

    context.save();
    context.translate(x, y);
    context.scale(direction, 1);
    context.rotate(-0.18 + Math.sin(progress * Math.PI) * 0.2);
    context.globalCompositeOperation = "lighter";
    context.lineCap = "round";
    context.shadowColor = slashColor;
    context.shadowBlur = isFire ? 22 : 14;

    context.strokeStyle = slashColor;
    context.lineWidth = isFire ? 12 : 9;
    context.beginPath();
    context.arc(0, 0, sweep, -0.95, 0.82);
    context.stroke();

    context.strokeStyle = coreColor;
    context.lineWidth = isFire ? 4 : 3;
    context.beginPath();
    context.arc(0, 0, sweep + 3, -0.83, 0.68);
    context.stroke();

    if (isFire) {
      context.strokeStyle = "rgba(255, 66, 24, 0.78)";
      context.lineWidth = 6;
      context.beginPath();
      context.arc(-6, 4, sweep + 12, -0.72, 0.58);
      context.stroke();
    }

    context.restore();
  }

  resolveProjectileImpact(projectile) {
    const defender = projectile.defender;
    if (!defender || defender.health <= 0 || defender.dead) return;

    const dodgeChance =
      defender.shield <= 0 &&
      (defender.energy || 0) >= 1 &&
      projectile.kind !== "fireSlash" &&
      (0.06 + Math.min(0.14, (defender.speedStat || 50) / 640));
    if (this.random() < dodgeChance) {
      defender.energy = Math.max(0, (defender.energy || 0) - 1);
      defender.mascotMotion = {
        kind: "hop",
        homeX: defender.homeX ?? defender.position.x,
        startedAt: this.now(),
        duration: 360,
        lift: 14,
      };
      defender.setMovementState("jump");
      const center = this.getMascotCore(defender);
      this.spawnSpriteFx("smokeDash", center.x, center.y + 66, {
        scale: 0.5,
        alpha: 0.72,
        layer: "behind",
      });
      this.spawnFloatingFx(defender, "DODGE", "#ffffff");
      this.updateEnergyHud(defender);
      this.playSfx("dodge", defender);
      return;
    }

    const canPanicBlock =
      (defender.energy || 0) >= 2 &&
      !defender.cooldowns?.shield &&
      projectile.damage >= 18 &&
      this.random() < 0.2;
    if (canPanicBlock) {
      defender.energy = Math.max(0, (defender.energy || 0) - 2);
      defender.cooldowns = { ...(defender.cooldowns || {}), shield: 2 };
      defender.shield = Math.min(72, (defender.shield || 0) + 28);
      defender.shieldVisibleUntil = this.now() + 1_150;
      const guard = this.getMascotCore(defender);
      this.spawnSpriteFx("water", guard.x, guard.y + 18, {
        scale: 0.66,
        composite: "lighter",
      });
      this.updateEnergyHud(defender);
    }

    const shieldBefore = defender.shield || 0;
    const absorbed = Math.min(shieldBefore, Math.round(projectile.damage * 0.72));
    const damage = Math.max(0, projectile.damage - absorbed);
    defender.shield = Math.max(0, shieldBefore - absorbed);
    if (absorbed > 0) {
      defender.shieldVisibleUntil = this.now() + 780;
    }
    if (damage > 0) {
      this.markFighterDamaged(defender);
      defender.takeHit(damage);
    } else if (defender.canControl?.()) {
      defender.setState("hitstun", { force: true });
    }
    this.preventPrematureArenaKnockout(defender);
    this.updateHealthBar(defender);
    this.spawnImpactFx(defender, projectile.color);
    const center = this.getMascotCore(defender);
    const isFire = projectile.kind === "volley" || projectile.kind === "fireball" || projectile.kind === "fireSlash";
    const isGrenade = projectile.kind === "grenade";
    const isSlash = projectile.kind === "slash" || projectile.kind === "fireSlash";
    if (isSlash) {
      this.spawnSlashFx(defender, projectile);
    }
    this.spawnSpriteFx(isFire || isGrenade ? "flame" : "water", center.x, center.y + 8, {
      scale: projectile.kind === "fireball" ? 0.92 : isGrenade ? 1.5 : isFire ? 0.78 : 0.66,
      composite: "lighter",
    });
    this.spawnSpriteFx("smokeImpact", center.x, center.y + 44, {
      scale: projectile.kind === "fireball" ? 0.72 : 0.58,
      alpha: 0.74,
    });
    if (defender.health <= 0) {
      this.spawnFloatingFx(defender, "DEFEATED", "#ff372f");
    } else {
      this.spawnFloatingFx(defender, absorbed > 0 ? (damage > 0 ? `-${damage} BLOCK` : "BLOCK") : `-${damage}`, damage > 0 ? "#ff372f" : projectile.color);
    }
    const impactSfx = absorbed > 0
      ? "shieldImpact"
      : isFire
        ? "fireImpact"
        : isSlash
          ? "slashImpact"
          : "hit";
    this.playSfx(impactSfx, defender);
    if (defender.health <= 0) {
      this.playSfx("death", defender);
    }
  }

  drawMascotShields() {
    const now = this.now();
    this.fighters.forEach((fighter) => {
      const visibleUntil = fighter.shieldVisibleUntil || 0;
      if (!fighter.shield || now > visibleUntil || fighter.health <= 0 || fighter.dead) return;

      const metrics = this.getMascotVisualMetrics(fighter);
      const pulse = Math.sin(now / 80) * 0.04;
      const alpha = Math.max(0.1, Math.min(0.42, (visibleUntil - now) / 900));
      const radiusX = metrics.width * (0.37 + pulse);
      const radiusY = metrics.height * (0.34 + pulse);
      const centerX = metrics.centerX;
      const centerY = metrics.y + metrics.height * 0.49;
      const shieldColor = fighter.tactics?.shieldColor || "#8eeeff";

      const gradient = this.context.createRadialGradient(centerX, centerY, 12, centerX, centerY, radiusX);
      gradient.addColorStop(0, "rgba(255,255,255,0.02)");
      gradient.addColorStop(0.58, `${shieldColor}24`);
      gradient.addColorStop(1, `${shieldColor}00`);

      this.context.save();
      this.context.globalCompositeOperation = "lighter";
      this.context.fillStyle = gradient;
      this.context.strokeStyle = shieldColor;
      this.context.globalAlpha = alpha;
      this.context.lineWidth = 4;
      this.context.shadowColor = shieldColor;
      this.context.shadowBlur = 14;
      this.context.beginPath();
      this.context.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
      this.context.fill();
      this.context.stroke();
      this.context.globalAlpha = alpha * 0.75;
      this.context.lineWidth = 1.5;
      this.context.beginPath();
      this.context.ellipse(centerX, centerY, radiusX * 0.78, radiusY * 0.78, 0, 0, Math.PI * 2);
      this.context.stroke();
      this.context.restore();
    });
  }

  markFighterDamaged(fighter, duration = 280) {
    if (!fighter) return;
    fighter.damageFlashUntil = this.now() + duration;
  }

  spawnImpactFx(fighter, color) {
    const center = this.getMascotCore(fighter);
    this.floatingFx.push({
      kind: "burst",
      x: center.x,
      y: center.y,
      color,
      startedAt: this.now(),
      duration: 300,
    });
  }

  spawnSlashFx(fighter, projectile) {
    const center = this.getMascotCore(fighter);
    this.floatingFx.push({
      kind: projectile.kind === "fireSlash" ? "fireSlash" : "slash",
      x: center.x,
      y: center.y + 2,
      direction: projectile.direction || 1,
      color: projectile.kind === "fireSlash" ? "#ff9d1e" : projectile.color || "#ffffff",
      startedAt: this.now(),
      duration: projectile.kind === "fireSlash" ? 420 : 340,
    });
  }

  spawnFloatingFx(fighter, text, color) {
    const center = this.getMascotCore(fighter);
    this.floatingFx.push({
      kind: "text",
      text,
      x: center.x,
      y: center.y - 112,
      color,
      startedAt: this.now(),
      duration: 720,
    });
  }

  updateFloatingFx() {
    if (!this.floatingFx.length) return;

    const now = this.now();
    this.floatingFx = this.floatingFx.filter((fx) => {
      const progress = Math.min(1, (now - fx.startedAt) / fx.duration);
      const alpha = 1 - progress;

      this.context.save();
      this.context.globalCompositeOperation = "lighter";
      this.context.globalAlpha = alpha;

      if (fx.kind === "burst") {
        const radius = 18 + progress * 46;
        this.context.strokeStyle = fx.color;
        this.context.shadowColor = fx.color;
        this.context.shadowBlur = 12;
        this.context.lineWidth = 2;
        this.context.beginPath();
        this.context.arc(fx.x, fx.y, radius, 0, Math.PI * 2);
        this.context.stroke();
      } else if (fx.kind === "slash" || fx.kind === "fireSlash") {
        const isFire = fx.kind === "fireSlash";
        const direction = fx.direction || 1;
        this.context.translate(fx.x, fx.y);
        this.context.scale(direction, 1);
        this.context.rotate(-0.2 + progress * 0.34);
        this.context.shadowColor = fx.color;
        this.context.shadowBlur = isFire ? 20 : 12;
        this.context.lineCap = "round";
        this.context.strokeStyle = fx.color;
        this.context.lineWidth = isFire ? 11 : 8;
        this.context.beginPath();
        this.context.arc(0, 0, 42 + progress * 20, -0.9, 0.95);
        this.context.stroke();
        this.context.strokeStyle = "rgba(255,255,255,0.9)";
        this.context.lineWidth = isFire ? 4 : 3;
        this.context.beginPath();
        this.context.arc(0, 0, 47 + progress * 18, -0.82, 0.82);
        this.context.stroke();
      } else {
        this.context.font = "900 22px system-ui, sans-serif";
        this.context.textAlign = "center";
        this.context.lineWidth = 5;
        this.context.strokeStyle = "rgba(7, 11, 24, 0.92)";
        this.context.fillStyle = fx.color;
        this.context.strokeText(fx.text, fx.x, fx.y - progress * 44);
        this.context.fillText(fx.text, fx.x, fx.y - progress * 44);
      }

      this.context.restore();
      return progress < 1;
    });
  }

  updateEnergyHud(fighter) {
    const index = this.fighters.indexOf(fighter);
    const root = this.query(`.player${index + 1}`);
    const ability = root?.querySelector(".hud-abilities span");
    if (!ability) return;

    const energy = Math.round(fighter.energy || 0);
    const maxEnergy = Math.round(fighter.maxEnergy || 6);
    const shield = Math.round(fighter.shield || 0);
    ability.textContent = shield > 0 ? `AP ${energy}/${maxEnergy} | SH ${shield}` : `AP ${energy}/${maxEnergy}`;
  }

  getMascotCore(fighter) {
    const metrics = this.getMascotVisualMetrics(fighter);
    if (metrics.width && metrics.height) {
      return {
        x: metrics.centerX,
        y: metrics.y + metrics.height * 0.47,
      };
    }

    const box = fighter.getCollisionBox();
    return {
      x: box.position.x + box.width / 2,
      y: box.position.y + box.height / 2 - 56,
    };
  }

  resolveBodyCollision() {
    for (let i = 0; i < this.fighters.length; i++) {
      for (let j = i + 1; j < this.fighters.length; j++) {
        CollisionSystem.resolveBodyCollision(this.fighters[i], this.fighters[j]);
      }
    }
  }

  resolveAttacks() {
    if (this.round.finished) return;

    for (const attacker of this.fighters) {
      if (!attacker.isAttacking) continue;

      const move = attacker.activeMove || attacker.attackConfig;
      const hitFrame = move.hitFrame;
      const isHitFrame = attacker.currentFrame === hitFrame;

      if (!isHitFrame) continue;

      const defender = this.fighters.find((fighter) => fighter !== attacker);
      if (
        defender &&
        !defender.dead &&
        defender.health > 0 &&
        CollisionSystem.attackOverlapsDefender(attacker, defender)
      ) {
        const damage = Math.max(
          1,
          Math.round(move.damage * (attacker.ai?.damageMultiplier || 1)),
        );
        this.markFighterDamaged(defender);
        defender.takeHit(damage);
        this.preventPrematureArenaKnockout(defender);
        this.updateHealthBar(defender);
        this.playSfx("hit", defender);
      }

      attacker.isAttacking = false;
      attacker.activeMove = null;
    }
  }

  stopRoundActions() {
    for (const fighter of this.fighters) {
      fighter.stopActions({ idle: fighter.health > 0 });
    }
  }

  restartRound({ resetRoundNumber = false } = {}) {
    if (!this.stage || this.fighterConfigs.length < 2) return;

    this.roundNumber = resetRoundNumber ? 1 : Math.max(1, this.roundNumber + 1);
    this.arenaRoundStartedAt = this.now();
    this.clearAutonomousRestart();
    this.round?.destroy();
    this.dismissResultDialog();
    this.queryAll(".damage-trail, .hit-spark, .damage-number, .win-confetti").forEach((element) =>
      element.remove(),
    );

    this.fighters = this.fighterConfigs.map((config) => this.createFighter(config));
    this.round = this.createRoundManager();
    this.round.start();
    this.prepareMechanics();
    this.syncBackgroundMusic();

    for (const fighter of this.fighters) {
      this.updateHealthBar(fighter);
    }

    if (this.arenaState) {
      this.applyArenaHud(this.arenaState, this.arenaWatchReward);
      this.resetArenaAiSchedule();
      this.applyArenaClock(this.arenaState);
    }
  }

  dismissResultDialog() {
    if (!this.dialogElement) return;

    this.rootElement?.classList?.remove("has-result-dialog");
    this.dialogElement.style.display = "none";
    this.dialogElement.style.pointerEvents = "none";
    this.dialogElement.innerHTML = "";
    this.dialogElement.removeAttribute("role");
    this.dialogElement.removeAttribute("aria-modal");
    this.dialogElement.removeAttribute("aria-label");
  }

  preventPrematureArenaKnockout(defender) {
    if (!this.autonomous || !this.arenaState || !this.round || this.round.remainingSeconds <= 2) {
      return;
    }
    if (defender.health > 0) return;

    defender.health = 8 + this.random() * 8;
    defender.dead = false;
    defender.setState("hitstun", { force: true });
  }

  applyArenaPayload(payload = {}) {
    const state = payload.state || payload;
    if (!state?.battleId) return;

    if (!this.round || this.fighters.length < 2) {
      this.pendingArenaPayload = payload;
      return;
    }

    const nextRoundKey = `${state.battleId}:${state.startsAt || state.endsAt || ""}`;
    const previousRoundKey = this.arenaRoundKey;
    if (!previousRoundKey || previousRoundKey !== nextRoundKey) {
      this.arenaRoundStartedAt = this.now();
    }
    const rngSeed = this.getArenaRngSeed(state);
    const rngSeedChanged = this.setArenaRngSeed(rngSeed);
    const incomingRemaining = Number(state.timeRemainingSeconds);
    this.autonomous = true;
    this.arenaState = state;
    this.arenaRoundKey = nextRoundKey;
    this.arenaCue = payload.cue || null;
    this.arenaWatchReward = payload.watchReward || payload.reward || null;

    const shouldRestartForNewRound = previousRoundKey && previousRoundKey !== nextRoundKey;
    const hasVisibleResultDialog = this.round?.finished && this.dialogElement?.style?.display !== "none";
    const shouldRecoverFinishedRound =
      !hasVisibleResultDialog &&
      this.round?.finished &&
      Number.isFinite(incomingRemaining) &&
      incomingRemaining > 3 &&
      incomingRemaining > Number(this.round.remainingSeconds || 0);

    if (shouldRestartForNewRound || shouldRecoverFinishedRound) {
      this.restartRound({ resetRoundNumber: shouldRestartForNewRound });
    }

    this.applyArenaHud(state, this.arenaWatchReward);
    if (rngSeedChanged) {
      this.resetArenaAiSchedule();
    }
    this.applyArenaClock(state);
    this.applyArenaCue(payload.cue);
  }

  normalizeArenaStat(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.round(numeric));
  }

  formatArenaCompactNumber(value) {
    const numeric = this.normalizeArenaStat(value);
    if (numeric >= 1_000_000) {
      return `${(numeric / 1_000_000).toFixed(numeric >= 10_000_000 ? 0 : 1)}M`;
    }
    if (numeric >= 1_000) {
      return `${(numeric / 1_000).toFixed(numeric >= 10_000 ? 0 : 1)}K`;
    }
    return numeric.toLocaleString();
  }

  readArenaCredits(state, watchReward) {
    const candidates = [
      state?.bantCreditsEarned,
      state?.spectatorBantCredits,
      watchReward?.earnedForBattle,
      watchReward?.earned,
      watchReward?.bantCredits,
    ];
    const valid = candidates.map(Number).filter(Number.isFinite);
    if (valid.length === 0) return 0;
    return this.normalizeArenaStat(Math.max(...valid));
  }

  readArenaSpectators(state) {
    return this.normalizeArenaStat(state?.spectators);
  }

  getArenaSideForFighter(fighter) {
    if (!fighter || !this.arenaState) return null;
    const sides = [this.arenaState.left, this.arenaState.right].filter(Boolean);
    return (
      sides.find((side) => side.id === fighter.arenaSideId) ||
      sides.find((side) => side.agentName === fighter.displayName) ||
      null
    );
  }

  readArenaSideRank(side, fighter, options = {}) {
    const candidates = [
      side?.newRank,
      side?.leaderboardRank,
      side?.rank,
      side?.profileRank,
      fighter?.rank,
      fighter?.tactics?.rank,
    ];
    const directRank = candidates.find((candidate) => Number.isFinite(Number(candidate)) && Number(candidate) > 0);
    if (directRank) return Math.max(1, Math.round(Number(directRank)));
    return "";
  }

  readArenaRankDelta(side, rank, spectators, options = {}) {
    if (!Number.isFinite(Number(rank)) || Number(rank) <= 0) return 0;
    const previousRankCandidates = [side?.previousRank, side?.oldRank, side?.priorRank];
    const previousRank = previousRankCandidates.find((candidate) => Number.isFinite(Number(candidate)) && Number(candidate) > 0);
    if (previousRank !== undefined) return Math.round(Number(previousRank)) - rank;

    const candidates = [side?.rankDelta, side?.rankChange, side?.rankMovement];
    const directDelta = candidates.find((candidate) => candidate !== null && candidate !== undefined && Number.isFinite(Number(candidate)));
    if (directDelta !== undefined) return Math.round(Number(directDelta));
    return 0;
  }

  buildRoundResultContext({ reason, winner } = {}) {
    const winnerFighter = winner?.fighter || null;
    const winnerSide = this.getArenaSideForFighter(winnerFighter);
    const spectators = this.readArenaSpectators(this.arenaState);
    const credits = this.readArenaCredits(this.arenaState, this.arenaWatchReward);
    const rank = this.readArenaSideRank(winnerSide, winnerFighter);
    const rankDelta = this.readArenaRankDelta(winnerSide, rank, spectators);
    const hasRank = Number.isFinite(Number(rank)) && Number(rank) > 0;
    const previousRank = hasRank && rankDelta !== 0 ? Math.max(1, Number(rank) + rankDelta) : rank;
    const rankDeltaDirection = rankDelta > 0 ? "up" : rankDelta < 0 ? "down" : "flat";
    const rankDeltaLabel =
      !hasRank
        ? "Rank unavailable"
        : rankDelta > 0
        ? `Climbed from #${previousRank} to #${rank}`
        : rankDelta < 0
          ? `Moved from #${Math.max(1, rank + rankDelta)} to #${rank}`
          : `Held #${rank}`;

    return {
      winnerName: winnerFighter?.displayName || winnerSide?.agentName || "BOTA Agent",
      winnerAvatar: winnerSide?.avatarUrl || winnerSide?.logoUrl || winnerFighter?.mascotAvatar || "",
      spectatorsLabel: this.formatArenaCompactNumber(spectators),
      bantCreditsLabel: `+${this.formatArenaCompactNumber(credits)}`,
      rankLabel: hasRank ? `#${rank}` : "#--",
      rankDeltaLabel,
      rankDeltaDirection,
      reasonLabel: reason === "ko" ? "Knockout Win" : "Arena Win",
    };
  }

  updateArenaLiveStats(state, watchReward = null) {
    const spectatorElement = this.query("[data-arena-spectators]");
    const creditsElement = this.query("[data-arena-bantcredits]");
    if (!spectatorElement && !creditsElement) return;

    const spectators = this.readArenaSpectators(state);
    const credits = this.readArenaCredits(state, watchReward);

    if (spectatorElement) {
      spectatorElement.textContent = this.formatArenaCompactNumber(spectators);
    }
    if (creditsElement) {
      creditsElement.textContent = `+${this.formatArenaCompactNumber(credits)}`;
    }
  }

  applyArenaHud(state, watchReward = null) {
    // this.updateArenaLiveStats(state, watchReward); // Disabled to allow React to manage the live pulse and watch rewards
    const sideStates = [state.left, state.right];
    sideStates.forEach((side, index) => {
      const fighter = this.fighters[index];
      if (!fighter || !side) return;

      fighter.displayName = side.agentName || side.label || fighter.displayName;
      fighter.arenaSideId = side.id;
      fighter.ai = {
        ...this.createDefaultAiProfile(),
        ...fighter.ai,
        aggression: side.confidence,
        damageMultiplier: 0.16 + (side.confidence / 100) * 0.14,
        speedMultiplier: 0.88 + (side.confidence / 100) * 0.28,
        cooldownMs: Math.max(620, 1_060 - side.confidence * 4),
        preferredRange: 132 + Math.max(0, side.confidence - 50) * 0.35,
      };
      if (this.mechanics === "mascot_tactics") {
        fighter.speedStat = (fighter.tactics?.speed || 50) + side.confidence * 0.12;
        fighter.energyRegen = side.confidence >= 62 ? 3 : fighter.tactics?.energyRegen || 2;
        this.updateEnergyHud(fighter);
      }

      const root = this.query(`.player${index + 1}`);
      const name = root?.querySelector(".player-name");
      const team = root?.querySelector(".player-team");
      const avatar = root?.querySelector(".avatar-ring img");
      const rankBadge = root?.querySelector(".avatar-rank-badge");

      if (name) name.textContent = fighter.displayName;
      if (team) team.textContent = side.label || side.chainLabel || "BOTA ARENA";
      if (rankBadge) {
        const rank = this.readArenaSideRank(side, fighter, { fallback: false });
        rankBadge.textContent = rank ? String(rank) : "";
        const rankDelta = rank ? this.readArenaRankDelta(side, rank, this.readArenaSpectators(this.arenaState), { fallback: false }) : 0;
        if (rankDelta > 0) {
          rankBadge.setAttribute("data-rank-move", "up");
        } else if (rankDelta < 0) {
          rankBadge.setAttribute("data-rank-move", "down");
        } else {
          rankBadge.removeAttribute("data-rank-move");
        }
        const movementLabel = rankDelta > 0
          ? `, climbed ${rankDelta} ranks`
          : rankDelta < 0
            ? `, dropped ${Math.abs(rankDelta)} ranks`
            : "";
        rankBadge.setAttribute("aria-label", `${fighter.displayName} leaderboard rank${rank ? ` #${rank}` : ""}${movementLabel}`);
      }
      if (avatar && this.mechanics === "mascot_tactics" && fighter.mascotAvatar) {
        avatar.src = fighter.mascotAvatar;
      } else if (avatar && (side.avatarUrl || side.logoUrl)) {
        avatar.src = side.avatarUrl || side.logoUrl;
      }
    });
  }

  applyArenaClock(state) {
    const remaining = Number(state.timeRemainingSeconds);
    if (Number.isFinite(remaining)) {
      const elapsedSeconds = Math.max(0, (this.now() - this.arenaRoundStartedAt) / 1000);
      const localRoundFloor = this.autonomous
        ? Math.max(0, this.minimumAutonomousRoundSeconds - elapsedSeconds)
        : 0;
      this.round.setRemainingSeconds(Math.max(remaining, localRoundFloor));
    }
  }

  applyArenaCue(cue) {
    if (!cue?.attackerSideId) return;
    const attacker = this.fighters.find((fighter) => fighter.arenaSideId === cue.attackerSideId);
    if (!attacker?.ai) return;

    attacker.ai.burstUntil = this.now() + 1_600;
    attacker.ai.nextAttackAt = Math.min(attacker.ai.nextAttackAt || 0, this.now() + 180);
  }

  resolveRoundWinner({ reason, fighters }) {
    if (this.autonomous && this.arenaState?.leadingSideId) {
      const winner = fighters.find((fighter) => fighter.arenaSideId === this.arenaState.leadingSideId);
      if (winner) {
        return {
          fighter: winner,
          message: `${winner.displayName} Wins`,
        };
      }
    }

    return null;
  }

  updateHealthBar(fighter) {
    const healthElement = this.query(fighter.healthSelector);
    if (!healthElement) return;

    const wrapper = healthElement.closest(".health-frame") || healthElement.parentElement;
    const playerCard = healthElement.closest(".player-card");
    const hpCurrentElement = playerCard?.querySelector(".hp-current");
    const hpReadoutElement = playerCard?.querySelector(".hp-readout");
    const previousHealth = Math.max(fighter.renderedHealth ?? 100, 0);
    const nextHealth = Math.max(fighter.health, 0);
    const width = `${nextHealth}%`;
    const maxHudHealth = Number(playerCard?.dataset?.maxHealth || 4070);

    if (hpReadoutElement && Number.isFinite(maxHudHealth)) {
      const currentHudHealth = Math.round((nextHealth / 100) * maxHudHealth);
      const maxHudHealthLabel = Math.round(maxHudHealth);
      hpReadoutElement.innerHTML = `<span class="hp-current">${currentHudHealth}</span> / ${maxHudHealthLabel}`;
    } else if (hpCurrentElement) {
      hpCurrentElement.textContent = Math.round((nextHealth / 100) * maxHudHealth);
    }

    if (wrapper && previousHealth > nextHealth) {
      this.playHealthHitEffect(wrapper, previousHealth, nextHealth);
    }

    if (window.gsap) {
      window.gsap.killTweensOf(healthElement);
      window.gsap.to(healthElement, {
        width,
        duration: 0.16,
        ease: "power2.out",
      });
    } else {
      healthElement.style.width = width;
    }

    fighter.renderedHealth = nextHealth;
  }

  playHealthHitEffect(wrapper, previousHealth, nextHealth) {
    const damageTrail = this.ensureHealthEffectElement(wrapper, "damage-trail");
    const hitSpark = this.ensureHealthEffectElement(wrapper, "hit-spark");
    const isPlayerOne = wrapper.closest(".player1");
    const sparkPosition = isPlayerOne ? 100 - nextHealth : nextHealth;
    const damageAmount = Math.round(previousHealth - nextHealth);

    wrapper.classList.remove("is-hit");
    hitSpark.classList.remove("is-active");
    void wrapper.offsetWidth;

    wrapper.classList.add("is-hit");
    window.setTimeout(() => wrapper.classList.remove("is-hit"), 260);

    damageTrail.style.width = `${previousHealth}%`;
    damageTrail.style.opacity = "1";
    hitSpark.style.left = `${sparkPosition}%`;
    hitSpark.classList.add("is-active");
    window.setTimeout(() => hitSpark.classList.remove("is-active"), 340);
    this.spawnDamageNumber(wrapper, sparkPosition, damageAmount);

    if (window.gsap) {
      window.gsap.killTweensOf(damageTrail);
      window.gsap.fromTo(
        damageTrail,
        { width: `${previousHealth}%`, opacity: 1 },
        {
          width: `${nextHealth}%`,
          opacity: 0.88,
          delay: 0.18,
          duration: 0.48,
          ease: "power3.out",
        },
      );
    } else {
      window.setTimeout(() => {
        damageTrail.style.transition = "width 480ms ease, opacity 480ms ease";
        damageTrail.style.width = `${nextHealth}%`;
        damageTrail.style.opacity = "0.88";
      }, 180);
    }
  }

  spawnDamageNumber(wrapper, position, damageAmount) {
    if (damageAmount <= 0) return;

    const number = document.createElement("div");
    number.className = "damage-number";
    number.textContent = `-${damageAmount}`;
    number.style.left = `${position}%`;
    wrapper.appendChild(number);

    window.setTimeout(() => number.remove(), 820);
  }

  ensureHealthEffectElement(wrapper, className) {
    let element = wrapper.querySelector(`.${className}`);
    if (!element) {
      element = document.createElement("div");
      element.className = className;
      wrapper.insertBefore(element, wrapper.querySelector(".health"));
    }

    return element;
  }

  clone(value) {
    if (value === undefined || value === null) return value;
    return JSON.parse(JSON.stringify(value));
  }
}

window.GameEngine = GameEngine;
