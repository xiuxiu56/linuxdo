// ==UserScript==
// @name         Linux.do 自动浏览助手 v2
// @namespace    https://linux.do/
// @version      2.0.0
// @description  自动浏览帖子、滚动查看所有回复、随机点赞、避免重复浏览
// @author       Assistant
// @match        https://linux.do/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  // ==================== 配置参数 ====================

  // 速度预设 (进一步调整避免429错误)
  const SPEED_PRESETS = {
    slow: {
      name: '慢速',
      scrollStep: 260,
      scrollInterval: 900,
      loadWaitTime: 4500,
      minReadTime: 1800,
      maxReadTime: 4000,
      noNewContentRetry: 4,
      wheelStepMin: 12,
      wheelStepMax: 30,
      wheelPauseMin: 55,
      wheelPauseMax: 140
    },
    normal: {
      name: '正常',
      scrollStep: 420,
      scrollInterval: 650,
      loadWaitTime: 3000,
      minReadTime: 900,
      maxReadTime: 1800,
      noNewContentRetry: 3,
      wheelStepMin: 20,
      wheelStepMax: 55,
      wheelPauseMin: 35,
      wheelPauseMax: 95
    },
    fast: {
      name: '快速',
      scrollStep: 650,
      scrollInterval: 420,
      loadWaitTime: 1800,
      minReadTime: 350,
      maxReadTime: 900,
      noNewContentRetry: 3,
      wheelStepMin: 35,
      wheelStepMax: 85,
      wheelPauseMin: 22,
      wheelPauseMax: 65
    },
    turbo: {
      name: '极速',
      scrollStep: 900,
      scrollInterval: 260,
      loadWaitTime: 1200,
      minReadTime: 120,
      maxReadTime: 350,
      noNewContentRetry: 2,
      wheelStepMin: 55,
      wheelStepMax: 130,
      wheelPauseMin: 14,
      wheelPauseMax: 38
    }
  };

  // 当前速度设置 (延迟初始化，等Storage类定义后再读取)
  let currentSpeed = 'normal';

  // 列表选择设置
  const LIST_OPTIONS = {
    latest: { name: '最新', path: '/latest' },
    new: { name: '新帖', path: '/new' },
    unread: { name: '未读', path: '/unseen' }
  };
  let currentList = 'latest';

  // 点赞开关
  let enableLike = true;

  // 点赞概率预设
  const LIKE_CHANCE_PRESETS = {
    low: { name: '低', value: 0.05 },      // 5%
    medium: { name: '中', value: 0.15 },   // 15%
    high: { name: '高', value: 0.25 },     // 25%
    veryHigh: { name: '极高', value: 0.40 } // 40%
  };
  let currentLikeChance = 'medium';

  const BROWSE_MODE_OPTIONS = {
    all: { name: '全部' },
    posts: { name: '楼层' },
    time: { name: '时间' },
    smart: { name: '智能' }
  };
  let currentBrowseMode = 'smart';

  const POST_LIMIT_OPTIONS = {
    20: { name: '20楼', value: 20 },
    40: { name: '40楼', value: 40 },
    80: { name: '80楼', value: 80 }
  };
  let currentPostLimit = '40';

  const TIME_LIMIT_OPTIONS = {
    30: { name: '30秒', value: 30 },
    60: { name: '60秒', value: 60 },
    120: { name: '120秒', value: 120 }
  };
  let currentTimeLimit = '60';

  const CONFIG = {
    // 动态从速度预设获取
    get scrollStep() { return SPEED_PRESETS[currentSpeed].scrollStep; },
    get scrollInterval() { return SPEED_PRESETS[currentSpeed].scrollInterval; },
    get loadWaitTime() { return SPEED_PRESETS[currentSpeed].loadWaitTime; },
    get minReadTime() { return SPEED_PRESETS[currentSpeed].minReadTime; },
    get maxReadTime() { return SPEED_PRESETS[currentSpeed].maxReadTime; },
    get noNewContentRetry() { return SPEED_PRESETS[currentSpeed].noNewContentRetry; },

    // 点赞设置 (动态从预设获取)
    get likeChance() { return LIKE_CHANCE_PRESETS[currentLikeChance].value; },
    minLikeInterval: 2000,        // 最小点赞间隔 (ms)

    // 会话设置
    maxLikesPerSession: 50,       // 每次会话最大点赞数
    maxTopicsPerSession: 50,      // 每次会话最大浏览话题数

    // 返回列表设置
    returnToListDelay: 1000,      // 返回列表前延迟 (ms)

    // 调试
    debug: true
  };

  function setSpeed(preset) {
    if (SPEED_PRESETS[preset]) {
      currentSpeed = preset;
      Storage.set('speed_preset', preset);
      log(`速度设置为: ${SPEED_PRESETS[preset].name}`);
    }
  }

  function setList(listType) {
    if (LIST_OPTIONS[listType]) {
      currentList = listType;
      Storage.set('list_type', listType);
      log(`列表设置为: ${LIST_OPTIONS[listType].name}`);
    }
  }

  function setEnableLike(enabled, updateUI = true) {
    enableLike = enabled;
    Storage.set('enable_like', enabled);
    log(`随机点赞: ${enabled ? '已开启' : '已关闭'}`);

    // 更新UI按钮状态
    if (updateUI) {
      document.querySelectorAll('.like-btn[data-like]').forEach(btn => {
        btn.classList.remove('active');
        if ((btn.dataset.like === 'true') === enabled) {
          btn.classList.add('active');
        }
      });
    }
  }

  // 检测点赞限制对话框
  // 实际DOM结构: div#dialog-holder > div.dialog-overlay + div.dialog-content > div.dialog-body(文字) + div.dialog-footer > button.btn-primary
  function checkLikeLimitDialog() {
    // 查找对话框
    const dialog = document.querySelector('#dialog-holder');
    if (!dialog) return false;

    // 使用 innerText 获取文字内容（比 textContent 更准确）
    const dialogText = dialog.innerText || dialog.textContent || '';
    const limitKeywords = [
      '点赞上限',
      '分享很多爱',
      'like limit',
      'sharing a lot of love'
    ];

    for (const keyword of limitKeywords) {
      if (dialogText.includes(keyword)) {
        log('检测到点赞限制提示！');
        return true;
      }
    }

    return false;
  }

  // 处理点赞限制：关闭点赞并关闭对话框
  function handleLikeLimit() {
    log('已达到点赞上限，自动关闭点赞功能');
    setEnableLike(false, true);

    // 尝试关闭对话框 - 点击 "确定" 按钮
    const closeBtn = document.querySelector(
      '#dialog-holder button.btn-primary, ' +
      '#dialog-holder .dialog-footer button, ' +
      '#dialog-holder button'
    );
    if (closeBtn) {
      closeBtn.click();
      log('已关闭点赞限制对话框');
    }
  }

  function setLikeChance(preset) {
    if (LIKE_CHANCE_PRESETS[preset]) {
      currentLikeChance = preset;
      Storage.set('like_chance', preset);
      const percent = Math.round(LIKE_CHANCE_PRESETS[preset].value * 100);
      log(`点赞概率设置为: ${LIKE_CHANCE_PRESETS[preset].name} (${percent}%)`);
    }
  }

  function setBrowseMode(mode) {
    if (BROWSE_MODE_OPTIONS[mode]) {
      currentBrowseMode = mode;
      Storage.set('browse_mode', mode);
      log(`帖子浏览模式设置为: ${BROWSE_MODE_OPTIONS[mode].name}`);
    }
  }

  function setPostLimit(limit) {
    if (POST_LIMIT_OPTIONS[limit]) {
      currentPostLimit = limit;
      Storage.set('post_limit', limit);
      log(`楼层浏览数量设置为: ${POST_LIMIT_OPTIONS[limit].name}`);
    }
  }

  function setTimeLimit(limit) {
    if (TIME_LIMIT_OPTIONS[limit]) {
      currentTimeLimit = limit;
      Storage.set('time_limit', limit);
      log(`时间浏览秒数设置为: ${TIME_LIMIT_OPTIONS[limit].name}`);
    }
  }

  // ==================== 工具函数 ====================

  function log(...args) {
    if (CONFIG.debug) {
      console.log('[LinuxDo自动化]', new Date().toLocaleTimeString(), ...args);
    }
  }

  const activeDelayResolvers = new Set();

  function randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;

    return new Promise(resolve => {
      let timer = null;

      const done = () => {
        if (timer) clearTimeout(timer);
        activeDelayResolvers.delete(done);
        resolve();
      };

      activeDelayResolvers.add(done);
      timer = setTimeout(done, delay);
    });
  }

  function cancelAllDelays() {
    for (const done of [...activeDelayResolvers]) {
      done();
    }
    activeDelayResolvers.clear();
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

    // 登录状态三态检测：true=已登录，false=未登录，null=无法判定（页面未就绪或 Cloudflare 挑战页）
  // 优先读取 #data-preloaded（服务端直出，脚本注入时必然存在），
  // 避免与 Ember 渲染 #current-user 竞速导致误判（脚本注入时 header 尚未渲染）
  function getLoginState() {
    const preloaded = document.querySelector('#data-preloaded');
    if (preloaded) {
      try {
        return 'currentUser' in JSON.parse(preloaded.dataset.preloaded);
      } catch (e) {
        // 解析失败，回退到 DOM 检测
      }
    }
    return document.querySelector('#current-user') !== null ? true : null;
  }

  function getPageType() {
    const path = window.location.pathname;
    if (path.match(/^\/t\/topic\/\d+/)) return 'topic';
    if (path === '/latest' || path === '/new' || path === '/unseen' ||
        path === '/' || path === '/top' || path === '/hot' ||
        path.startsWith('/c/') || path.startsWith('/tag/')) return 'list';
    return 'other';
  }

  function getTopicIdFromUrl(url) {
    const match = url?.match(/\/t\/topic\/(\d+)/);
    return match ? match[1] : null;
  }

  function getCurrentTopicId() {
    return getTopicIdFromUrl(window.location.pathname);
  }

  function getNormalizedListBase(path = window.location.pathname) {
    if (!path || path === '/' || path === '/latest' || path === '/new' || path === '/unseen') {
      return '';
    }

    return path
      .replace(/\/l\/(latest|new|unseen)\/?$/, '')
      .replace(/\/$/, '');
  }

  function getListPathFor(listType, sourcePath = null) {
    const rawPath = sourcePath || Storage.get('last_list_path', window.location.pathname);
    const base = getNormalizedListBase(rawPath);

    if (!base) {
      return LIST_OPTIONS[listType]?.path || '/latest';
    }

    if (listType === 'latest') return base;
    if (listType === 'new') return `${base}/l/new`;
    if (listType === 'unread') return `${base}/l/unseen`;

    return base;
  }

  // ==================== 存储管理 ====================

  class Storage {
    static get(key, defaultValue = null) {
      try {
        if (typeof GM_getValue !== 'undefined') {
          const val = GM_getValue(key, null);
          return val !== null ? val : defaultValue;
        }
        const value = localStorage.getItem(`linuxdo_${key}`);
        return value ? JSON.parse(value) : defaultValue;
      } catch (e) {
        return defaultValue;
      }
    }

    static set(key, value) {
      try {
        if (typeof GM_setValue !== 'undefined') {
          GM_setValue(key, value);
        } else {
          localStorage.setItem(`linuxdo_${key}`, JSON.stringify(value));
        }
      } catch (e) {
        log('存储失败:', e);
      }
    }
  }

  // 初始化设置 (Storage类已定义)
  currentSpeed = Storage.get('speed_preset', 'normal');
  currentList = Storage.get('list_type', 'latest');
  enableLike = Storage.get('enable_like', true);
  currentLikeChance = Storage.get('like_chance', 'medium');
  currentBrowseMode = Storage.get('browse_mode', 'smart');
  currentPostLimit = Storage.get('post_limit', '40');
  currentTimeLimit = Storage.get('time_limit', '60');

  // ==================== 浏览记录管理 ====================

  class BrowsingHistory {
    constructor() {
      this.viewed = new Set(Storage.get('viewed_topics', []));
      this.liked = new Set(Storage.get('liked_posts', []));
      this.sessionViewed = 0;
      this.sessionLiked = 0;
    }

    isTopicViewed(topicId) {
      return this.viewed.has(String(topicId));
    }

    markTopicViewed(topicId) {
      const id = String(topicId);
      if (!this.viewed.has(id)) {
        this.viewed.add(id);
        this.sessionViewed++;
        this.save();
        log(`标记话题 ${id} 为已浏览，本次会话已浏览 ${this.sessionViewed} 个`);
      }
    }

    isPostLiked(postId) {
      return this.liked.has(String(postId));
    }

    markPostLiked(postId) {
      const id = String(postId);
      if (!this.liked.has(id)) {
        this.liked.add(id);
        this.sessionLiked++;
        this.save();
      }
    }

    save() {
      Storage.set('viewed_topics', [...this.viewed]);
      Storage.set('liked_posts', [...this.liked]);
    }

    clearHistory() {
      this.viewed.clear();
      this.liked.clear();
      this.save();
      log('已清除所有浏览历史');
    }

    getStats() {
      return {
        totalViewed: this.viewed.size,
        totalLiked: this.liked.size,
        sessionViewed: this.sessionViewed,
        sessionLiked: this.sessionLiked
      };
    }

    canContinue() {
      return this.sessionViewed < CONFIG.maxTopicsPerSession &&
             this.sessionLiked < CONFIG.maxLikesPerSession;
    }
  }

  // ==================== 滚动控制器 ====================

  class ScrollController {
    constructor() {
      this.lastScrollHeight = 0;
      this.noNewContentCount = 0;
    }

    getScrollInfo() {
      return {
        scrollTop: window.pageYOffset || document.documentElement.scrollTop,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight
      };
    }

    isAtBottom() {
      const { scrollTop, scrollHeight, clientHeight } = this.getScrollInfo();
      return scrollTop + clientHeight >= scrollHeight - 100;
    }

    isAtTop() {
      return this.getScrollInfo().scrollTop < 100;
    }

    async scrollDown() {
      const preset = SPEED_PRESETS[currentSpeed];
    
      let remaining = Math.max(
        CONFIG.scrollStep + randomInt(-80, 80),
        120
      );
    
      while (remaining > 0) {
        const step = Math.min(
          randomInt(preset.wheelStepMin, preset.wheelStepMax),
          remaining
        );
    
        window.scrollBy({
          top: step,
          behavior: 'auto'
        });
    
        remaining -= step;
    
        await randomDelay(
          preset.wheelPauseMin,
          preset.wheelPauseMax
        );
    
        // 偶尔像真人一样短暂停顿
        if (Math.random() < 0.07) {
          await randomDelay(220, 650);
        }
    
        // 偶尔轻微回滚
        if (Math.random() < 0.025 && remaining > 100) {
          window.scrollBy({
            top: -randomInt(8, 28),
            behavior: 'auto'
          });
    
          await randomDelay(80, 180);
        }
      }
    }

    async scrollToTop() {
      window.scrollTo({ top: 0, behavior: 'auto' });
      await randomDelay(200, 400);
    }

    hasNewContent() {
      const currentHeight = document.documentElement.scrollHeight;
      if (currentHeight > this.lastScrollHeight) {
        this.lastScrollHeight = currentHeight;
        this.noNewContentCount = 0;
        return true;
      }
      this.noNewContentCount++;
      return false;
    }

    isContentFullyLoaded() {
      return this.noNewContentCount >= CONFIG.noNewContentRetry;
    }

    reset() {
      this.lastScrollHeight = document.documentElement.scrollHeight;
      this.noNewContentCount = 0;
    }
  }

  // ==================== 帖子详情页浏览器 ====================

  class TopicBrowser {
    constructor(history, onStatsUpdate) {
      this.history = history;
      this.onStatsUpdate = onStatsUpdate;
      this.scrollController = new ScrollController();
      this.isRunning = false;
      this.viewedPosts = new Set();
      this.lastLikeTime = 0;
      this.browseStartTime = 0;
      this.hasStartedScrolling = false;
      this.effectiveBrowseMode = currentBrowseMode;
      this.targetPostLimit = POST_LIMIT_OPTIONS[currentPostLimit]?.value || 40;
      this.targetTimeLimit = (TIME_LIMIT_OPTIONS[currentTimeLimit]?.value || 60) * 1000;
    }

    async start() {
      if (this.isRunning) return;
      this.isRunning = true;

      const topicId = getCurrentTopicId();
      if (!topicId) {
        log('无法获取话题ID');
        this.stop();
        return;
      }

      log(`开始浏览话题 ${topicId}...`);

      // 标记为已浏览
      this.history.markTopicViewed(topicId);
      this.onStatsUpdate?.();

      // 确保从第一楼开始浏览
      await this.goToFirstPost(topicId);

      // 滚动到顶部开始
      await this.scrollController.scrollToTop();
      this.scrollController.reset();

      // 注意：必须回到第一楼和顶部之后才开始计时，否则时间模式会过早退出
      this.initBrowsePlan();

      // 开始滚动浏览
      await this.browseAllReplies();

      // 浏览完成，返回列表
      if (this.isRunning) {
        await this.returnToList();
      }
    }

    stop() {
      this.isRunning = false;
      log('停止浏览');
    }

    initBrowsePlan() {
      this.browseStartTime = Date.now();
      this.hasStartedScrolling = false;
      this.effectiveBrowseMode = currentBrowseMode;
      this.targetPostLimit = POST_LIMIT_OPTIONS[currentPostLimit]?.value || 40;
      this.targetTimeLimit = (TIME_LIMIT_OPTIONS[currentTimeLimit]?.value || 60) * 1000;

      if (currentBrowseMode === 'smart') {
        const r = Math.random();

        if (r < 0.65) {
          this.effectiveBrowseMode = 'posts';
          this.targetPostLimit = randomInt(20, 50);
        } else if (r < 0.9) {
          this.effectiveBrowseMode = 'time';
          this.targetTimeLimit = randomInt(45, 100) * 1000;
        } else {
          this.effectiveBrowseMode = 'all';
        }
      }

      log(
        `本帖浏览计划: ${BROWSE_MODE_OPTIONS[this.effectiveBrowseMode]?.name || this.effectiveBrowseMode}, ` +
        `楼层目标: ${this.targetPostLimit}, 时间目标: ${Math.round(this.targetTimeLimit / 1000)}秒`
      );
    }

    shouldFinishBrowsing() {
      if (this.effectiveBrowseMode === 'all') return false;

      // 保护：至少真正开始滚动后才允许退出
      if (!this.hasStartedScrolling) return false;

      if (this.effectiveBrowseMode === 'posts') {
        return this.viewedPosts.size >= this.targetPostLimit;
      }

      if (this.effectiveBrowseMode === 'time') {
        return Date.now() - this.browseStartTime >= this.targetTimeLimit;
      }

      return false;
    }

    // 跳转到帖子第一楼
    async goToFirstPost(topicId) {
      const currentPath = window.location.pathname;
      const firstPostPath = `/t/topic/${topicId}/1`;

      // 检查是否已经在第一楼附近
      if (currentPath === firstPostPath || currentPath === `/t/topic/${topicId}`) {
        log('已在帖子顶部');
        return;
      }

      log('跳转到帖子第一楼...');

      // 方法1: 尝试点击"跳到第一个帖子"按钮
      const jumpToFirstBtn = document.querySelector('a[href*="/1"][title*="第一"], a.jump-to-first');
      if (jumpToFirstBtn) {
        jumpToFirstBtn.click();
        await randomDelay(1500, 2000);
        return;
      }

      // 方法2: 直接修改URL跳转到第一楼
      window.location.href = firstPostPath;
      await randomDelay(2000, 2500);
    }

    async browseAllReplies() {
      log('开始滚动浏览所有回复...');

      while (this.isRunning) {
        try {
          // 处理当前可见的帖子
          await this.processVisiblePosts();

          // 更新心跳（即使没有新帖子）
          this.onStatsUpdate?.();

          if (this.shouldFinishBrowsing()) {
            log('已达到当前帖子浏览目标，准备返回列表');
            break;
          }

          // 检查是否到达底部
          if (this.scrollController.isAtBottom()) {
            log('到达页面底部，等待加载新内容...');
            await randomDelay(CONFIG.loadWaitTime, CONFIG.loadWaitTime * 1.2);

            // 检查是否有新内容加载
            if (!this.scrollController.hasNewContent()) {
              log(`无新内容 (${this.scrollController.noNewContentCount}/${CONFIG.noNewContentRetry})`);

              if (this.scrollController.isContentFullyLoaded()) {
                log('所有回复已浏览完成');
                break;
              }
            } else {
              log('检测到新内容加载');
            }
          }

          // 继续滚动
          await this.scrollController.scrollDown();
          this.hasStartedScrolling = true;
          await randomDelay(CONFIG.scrollInterval, CONFIG.scrollInterval * 1.3);
        } catch (error) {
          log('浏览回复出错:', error.message);
          // 出错后短暂等待再继续
          await randomDelay(2000, 3000);
        }
      }
    }

    async processVisiblePosts() {
      const posts = document.querySelectorAll('article[id^="post_"]');
      const viewportHeight = window.innerHeight;
      let newPostFound = false;

      for (const post of posts) {
        if (!this.isRunning) break;

        const rect = post.getBoundingClientRect();
        // 检查帖子是否在视口中
        if (rect.top < viewportHeight * 0.9 && rect.bottom > viewportHeight * 0.1) {
          const postId = post.id.replace('post_', '');

          if (!this.viewedPosts.has(postId)) {
            this.viewedPosts.add(postId);
            newPostFound = true;

            this.onStatsUpdate?.();

            // 只有发现新帖子时才等待阅读时间
            if (CONFIG.minReadTime > 0) {
              await randomDelay(CONFIG.minReadTime, CONFIG.maxReadTime);
            }

            // 随机决定是否点赞
            if (this.shouldLike()) {
              await this.tryLikePost(post, postId);
            }
          }
        }
      }

      return newPostFound;
    }

    shouldLike() {
      // 检查点赞开关
      if (!enableLike) return false;
      if (this.history.sessionLiked >= CONFIG.maxLikesPerSession) return false;
      const now = Date.now();
      if (now - this.lastLikeTime < CONFIG.minLikeInterval) return false;
      return Math.random() < CONFIG.likeChance;
    }

    async tryLikePost(postElement, postId) {
      if (this.history.isPostLiked(postId)) {
        return false;
      }

      // 获取实际的帖子ID (从 data-post-id 属性)
      const actualPostId = postElement.dataset.postId;
      if (!actualPostId) {
        log(`无法获取帖子 #${postId} 的实际ID`);
        return false;
      }

      // 检查点赞按钮状态，判断是否已点赞
      const likeBtn = postElement.querySelector(
        'button[title="点赞此帖子"], ' +
        'button.btn-toggle-reaction-like'
      );
      if (likeBtn && (likeBtn.classList.contains('has-like') ||
          likeBtn.classList.contains('my-likes') ||
          likeBtn.classList.contains('liked'))) {
        return false;
      }

      try {
        await randomDelay(200, 500);

        // 通过接口发送点赞请求
        const result = await this.sendLikeRequest(actualPostId);

        if (result.success) {
          this.history.markPostLiked(postId);
          this.lastLikeTime = Date.now();
          this.onStatsUpdate?.();
          log(`点赞帖子 #${postId} (ID: ${actualPostId})`);
          return true;
        } else if (result.rateLimited) {
          // 达到点赞上限
          log(`点赞达到上限，剩余等待: ${result.timeLeft || '未知'}`);
          handleLikeLimit();
          return false;
        } else {
          log(`点赞失败: ${result.error}`);
          return false;
        }
      } catch (e) {
        log('点赞失败:', e);
        return false;
      }
    }

    // 发送点赞请求到接口
    async sendLikeRequest(postId) {
      try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
        if (!csrfToken) {
          return { success: false, error: '无法获取CSRF Token' };
        }

        const response = await fetch(`/discourse-reactions/posts/${postId}/custom-reactions/heart/toggle.json`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
          }
        });

        // 根据状态码判断结果
        if (response.ok) {
          return { success: true };
        }

        // 解析错误响应
        const data = await response.json().catch(() => ({}));

        // 429 = 速率限制 (达到点赞上限)
        if (response.status === 429 || data.error_type === 'rate_limit') {
          return {
            success: false,
            rateLimited: true,
            timeLeft: data.extras?.time_left,
            waitSeconds: data.extras?.wait_seconds,
            error: data.errors?.[0] || '达到点赞上限'
          };
        }

        return {
          success: false,
          error: data.errors?.[0] || `HTTP ${response.status}`
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }

    async returnToList() {
      log('准备返回话题列表...');
      await randomDelay(CONFIG.returnToListDelay, CONFIG.returnToListDelay * 1.5);

      if (!this.isRunning) {
        log('已停止，不返回列表');
        return;
      }

      // 根据进入帖子前的列表路径返回，支持 /latest /new /unseen 和 /tag/.../l/new 等
      const returnUrl = getListPathFor(currentList);

      log(`返回列表: ${returnUrl}`);
      window.location.href = returnUrl;
    }
  }

  // ==================== 话题列表浏览器 ====================

  class TopicListBrowser {
    constructor(history, onStatsUpdate) {
      this.history = history;
      this.onStatsUpdate = onStatsUpdate;
      this.scrollController = new ScrollController();
      this.isRunning = false;
      this.scannedTopics = new Set();
    }

    async start() {
      if (this.isRunning) return;
      this.isRunning = true;

      log('开始在列表中查找未浏览的话题...');
      this.scrollController.reset();

      // 先尝试在当前可见区域查找
      let found = await this.findAndEnterUnviewedTopic();

      // 如果没找到，滚动加载更多
      while (this.isRunning && !found) {
        try {
          // 更新心跳
          this.onStatsUpdate?.();

          if (this.scrollController.isAtBottom()) {
            log('到达列表底部，等待加载...');
            await randomDelay(CONFIG.loadWaitTime, CONFIG.loadWaitTime * 1.2);

            if (!this.scrollController.hasNewContent()) {
              log(`无新话题加载 (${this.scrollController.noNewContentCount}/${CONFIG.noNewContentRetry})`);

              if (this.scrollController.isContentFullyLoaded()) {
                log('列表已全部加载，尝试切换到其他列表');
                await this.switchToAnotherList();
                return;
              }
            }
          }

          // 滚动加载更多
          await this.scrollController.scrollDown();
          await randomDelay(CONFIG.scrollInterval, CONFIG.scrollInterval * 1.2);

          // 再次尝试查找
          found = await this.findAndEnterUnviewedTopic();
        } catch (error) {
          log('列表浏览出错:', error.message);
          // 出错后短暂等待再继续
          await randomDelay(2000, 3000);
        }
      }
    }

    stop() {
      this.isRunning = false;
      log('停止列表浏览');
    }

    async findAndEnterUnviewedTopic() {
      // 获取所有话题链接
      const topicRows = document.querySelectorAll(
        '.topic-list-item, ' +
        'tr[data-topic-id], ' +
        '.topic-list tr'
      );

      for (const row of topicRows) {
        if (!this.isRunning) return false;

        const titleLink = row.querySelector(
          '.title a[href*="/t/topic/"], ' +
          '.link-top-line a[href*="/t/topic/"], ' +
          'a.title[href*="/t/topic/"]'
        );

        if (!titleLink) continue;

        const topicId = getTopicIdFromUrl(titleLink.href);
        if (!topicId) continue;

        // 跳过已扫描的
        if (this.scannedTopics.has(topicId)) continue;
        this.scannedTopics.add(topicId);

        // 检查是否已浏览
        if (this.history.isTopicViewed(topicId)) {
          // 给已浏览的话题添加视觉标记
          this.markAsViewed(row);
          continue;
        }

        // 找到未浏览的话题
        log(`找到未浏览话题: ${topicId}`);

        // 检查会话限制
        if (!this.history.canContinue()) {
          log('达到会话限制，停止');
          this.stop();
          return false;
        }

        // 记录当前列表路径，返回时继续留在当前 tag/category/list
        Storage.set('last_list_path', window.location.pathname);

        // 快速滚动到链接位置
        titleLink.scrollIntoView({ behavior: 'auto', block: 'center' });
        await randomDelay(300, 600);

        // 点击进入
        log(`进入话题: ${topicId}`);
        titleLink.click();
        return true;
      }

      return false;
    }

    markAsViewed(row) {
      if (!row.classList.contains('auto-viewed')) {
        row.classList.add('auto-viewed');
        row.style.opacity = '0.6';
        // 添加已浏览标记
        const badge = document.createElement('span');
        badge.textContent = '✓';
        badge.style.cssText = 'color: #4CAF50; margin-left: 5px; font-weight: bold;';
        badge.className = 'viewed-badge';
        const title = row.querySelector('.title, .link-top-line');
        if (title && !title.querySelector('.viewed-badge')) {
          title.appendChild(badge);
        }
      }
    }

    async switchToAnotherList() {
      // 根据当前列表路径刷新，支持 tag/category 内切换
      const targetList = getListPathFor(currentList, window.location.pathname);
      log(`当前列表已浏览完，刷新列表: ${targetList}`);
      await randomDelay(1000, 2000);

      if (!this.isRunning) {
        log('已停止，不刷新列表');
        return;
      }

      window.location.href = targetList;
    }
  }

  // ==================== 主控制器 ====================

  class LinuxDoAutomation {
    constructor() {
      this.history = new BrowsingHistory();
      this.topicBrowser = null;
      this.listBrowser = null;
      this.isEnabled = false;
      this.panel = null;
      // 卡住检测
      this.lastActivityTime = Date.now();
      this.stuckCheckInterval = null;
      this.stuckTimeout = 30000; // 30秒无活动认为卡住
      // URL变化监听（处理SPA导航）
      this.lastUrl = window.location.href;
      this.urlCheckInterval = null;
    }

    // 更新活动时间（心跳）
    heartbeat() {
      this.lastActivityTime = Date.now();
    }

    // 检查是否卡住
    checkStuck() {
      if (!this.isEnabled) return;

      const now = Date.now();
      const elapsed = now - this.lastActivityTime;

      if (elapsed > this.stuckTimeout) {
        log(`检测到卡住 (${Math.round(elapsed/1000)}秒无活动)，自动重启...`);
        this.restartBrowsing();
      }
    }

    // 重启浏览
    async restartBrowsing() {
      // 先停止当前浏览器
      this.topicBrowser?.stop();
      this.listBrowser?.stop();

      // 重置状态
      this.heartbeat();

      // 重新开始
      const pageType = getPageType();
      log(`重启浏览，当前页面: ${pageType}`);

      try {
        if (pageType === 'topic') {
          // 重新创建TopicBrowser实例
          this.topicBrowser = new TopicBrowser(this.history, () => {
            this.updateStats();
            this.heartbeat();
          });
          await this.topicBrowser.start();
        } else if (pageType === 'list') {
          // 重新创建ListBrowser实例
          this.listBrowser = new TopicListBrowser(this.history, () => {
            this.updateStats();
            this.heartbeat();
          });
          await this.listBrowser.start();
        } else {
          log('不支持的页面，跳转到列表');
          window.location.href = LIST_OPTIONS[currentList]?.path || '/latest';
        }
      } catch (error) {
        log('重启出错:', error.message);
        // 出错后跳转到列表重新开始
        await randomDelay(3000, 5000);
        window.location.href = LIST_OPTIONS[currentList]?.path || '/latest';
      }
    }

    // 启动卡住检测
    startStuckDetection() {
      if (this.stuckCheckInterval) {
        clearInterval(this.stuckCheckInterval);
      }
      this.heartbeat();
      // 每10秒检查一次
      this.stuckCheckInterval = setInterval(() => this.checkStuck(), 10000);
      log('卡住检测已启动');
    }

    // 停止卡住检测
    stopStuckDetection() {
      if (this.stuckCheckInterval) {
        clearInterval(this.stuckCheckInterval);
        this.stuckCheckInterval = null;
      }
    }

    // 启动URL变化监听（处理SPA导航）
    startUrlWatcher() {
      if (this.urlCheckInterval) {
        clearInterval(this.urlCheckInterval);
      }
      this.lastUrl = window.location.href;
      // 每500ms检查一次URL是否变化
      this.urlCheckInterval = setInterval(() => this.checkUrlChange(), 500);
      log('URL监听已启动');
    }

    // 停止URL变化监听
    stopUrlWatcher() {
      if (this.urlCheckInterval) {
        clearInterval(this.urlCheckInterval);
        this.urlCheckInterval = null;
      }
    }

    // 检查URL是否变化
    checkUrlChange() {
      const currentUrl = window.location.href;
      if (currentUrl !== this.lastUrl) {
        const oldPageType = this.getPageTypeFromUrl(this.lastUrl);
        const newPageType = getPageType();
        log(`检测到URL变化: ${oldPageType} -> ${newPageType}`);
        this.lastUrl = currentUrl;

        // 如果正在运行且页面类型发生变化，重新初始化浏览器
        if (this.isEnabled && oldPageType !== newPageType) {
          log('页面类型变化，重新初始化浏览器...');
          this.handlePageTypeChange(newPageType);
        }
      }
    }

    // 从URL解析页面类型
    getPageTypeFromUrl(url) {
      try {
        const path = new URL(url).pathname;
        if (path.match(/^\/t\/topic\/\d+/)) return 'topic';
        if (path === '/latest' || path === '/new' || path === '/unseen' ||
            path === '/' || path === '/top' || path === '/hot' ||
            path.startsWith('/c/') || path.startsWith('/tag/')) return 'list';
        return 'other';
      } catch (e) {
        return 'other';
      }
    }

    // 处理页面类型变化
    async handlePageTypeChange(newPageType) {
      // 停止当前浏览器
      this.topicBrowser?.stop();
      this.listBrowser?.stop();

      // 等待页面内容加载
      await randomDelay(1000, 1500);

      // 更新心跳
      this.heartbeat();

      // 根据新页面类型启动相应浏览器
      try {
        if (newPageType === 'topic') {
          log('切换到帖子浏览模式');
          this.topicBrowser = new TopicBrowser(this.history, () => {
            this.updateStats();
            this.heartbeat();
          });
          await this.topicBrowser.start();
        } else if (newPageType === 'list') {
          log('切换到列表浏览模式');
          this.listBrowser = new TopicListBrowser(this.history, () => {
            this.updateStats();
            this.heartbeat();
          });
          await this.listBrowser.start();
        } else {
          log('不支持的页面类型，跳转到列表');
          window.location.href = LIST_OPTIONS[currentList]?.path || '/latest';
        }
      } catch (error) {
        log('页面切换处理出错:', error.message);
        await randomDelay(2000, 3000);
        this.restartBrowsing();
      }
    }

    init() {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.setup());
      } else {
        this.setup();
      }
    }

    setup(retryCount = 0) {
      const loginState = getLoginState();

      // 无法判定登录状态（Ember 未渲染完成或 Cloudflare 挑战页）：轮询等待，最多 10 秒
      // 挑战页通过后会整页跳转、脚本重新注入，因此超时放弃是安全的
      if (loginState === null) {
        if (retryCount < 20) {
          setTimeout(() => this.setup(retryCount + 1), 500);
        } else {
          log('无法检测登录状态，跳过初始化');
        }
        return;
      }

      if (loginState === false) {
        log('请先登录 Linux.do');
        return;
      }

      this.createControlPanel();

      // 初始化浏览器
      this.topicBrowser = new TopicBrowser(this.history, () => this.updateStats());
      this.listBrowser = new TopicListBrowser(this.history, () => this.updateStats());

      // 检查是否需要自动继续
      const autoResume = Storage.get('auto_running', false);
      log('脚本已加载, auto_running:', autoResume);

      if (autoResume) {
        log('检测到自动运行状态，3秒后恢复运行...');
        // 增加延迟确保页面完全加载
        setTimeout(() => {
          log('自动恢复运行...');
          this.start();
        }, 3000);
      }
      this.updateStats();
    }

    createControlPanel() {
      const style = document.createElement('style');
      style.textContent = `
        #linuxdo-auto-panel {
          position: fixed;
          top: 80px;
          right: 20px;
          z-index: 99999;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 12px;
          padding: 16px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.25);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 13px;
          color: #fff;
          min-width: 240px;
          transition: all 0.3s ease;
          will-change: left, top;
          touch-action: none;
        }
        #linuxdo-auto-panel.minimized {
          min-width: 150px;
          padding: 10px 12px;
        }
        #linuxdo-auto-panel.minimized .panel-content {
          display: none;
        }
        #linuxdo-auto-panel h3 {
          margin: 0 0 12px 0;
          font-size: 15px;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          cursor: move;
          user-select: none;
          white-space: nowrap;
        }
        #linuxdo-auto-panel.dragging {
          transition: none !important;
          cursor: grabbing;
          opacity: 0.95;
        }

        #linuxdo-auto-panel.dragging * {
          user-select: none;
        }
        #linuxdo-auto-panel .btn-minimize {
          background: rgba(255,255,255,0.2);
          border: none;
          color: #fff;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          cursor: pointer;
          font-size: 14px;
        }
        #linuxdo-auto-panel button.action-btn {
          width: 100%;
          padding: 10px;
          margin: 5px 0;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          transition: all 0.2s ease;
        }
        #linuxdo-auto-panel .speed-selector {
          display: flex;
          align-items: center;
          margin-bottom: 10px;
          gap: 8px;
        }
        #linuxdo-auto-panel .speed-label {
          font-size: 12px;
          opacity: 0.9;
        }
        #linuxdo-auto-panel .speed-buttons {
          display: flex;
          gap: 4px;
          flex: 1;
        }
        #linuxdo-auto-panel .speed-btn {
          flex: 1;
          padding: 5px 8px;
          border: none;
          border-radius: 4px;
          background: rgba(255,255,255,0.2);
          color: #fff;
          font-size: 11px;
          cursor: pointer;
          transition: all 0.2s;
        }
        #linuxdo-auto-panel .speed-btn:hover {
          background: rgba(255,255,255,0.3);
        }
        #linuxdo-auto-panel .speed-btn.active {
          background: #4CAF50;
          font-weight: 600;
        }
        #linuxdo-auto-panel .btn-start { background: #4CAF50; color: white; }
        #linuxdo-auto-panel .btn-start:hover { background: #43A047; }
        #linuxdo-auto-panel .btn-stop { background: #f44336; color: white; }
        #linuxdo-auto-panel .btn-stop:hover { background: #E53935; }
        #linuxdo-auto-panel .btn-clear { background: #FF9800; color: white; font-size: 12px; padding: 6px; }
        #linuxdo-auto-panel .stats {
          margin-top: 12px;
          padding: 10px;
          background: rgba(255,255,255,0.15);
          border-radius: 8px;
        }
        #linuxdo-auto-panel .stats-row {
          display: flex;
          justify-content: space-between;
          margin: 4px 0;
          font-size: 12px;
        }
        #linuxdo-auto-panel .stats-label { opacity: 0.9; }
        #linuxdo-auto-panel .stats-value { font-weight: 600; }
        #linuxdo-auto-panel .status-indicator {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 6px;
        }
        #linuxdo-auto-panel .status-indicator.running {
          background: #4CAF50;
          animation: pulse 1.5s infinite;
        }
        #linuxdo-auto-panel .status-indicator.stopped { background: #f44336; }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .auto-viewed { opacity: 0.6; }
      `;
      document.head.appendChild(style);

      const panel = document.createElement('div');
      panel.id = 'linuxdo-auto-panel';
      panel.innerHTML = `
        <h3>
          <span>Linux.do 自动浏览助手</span>
          <button class="btn-minimize" id="btn-minimize">-</button>
        </h3>
        <div class="panel-content">
          <div class="speed-selector">
            <span class="speed-label">速度:</span>
            <div class="speed-buttons">
              <button class="speed-btn ${currentSpeed === 'slow' ? 'active' : ''}" data-speed="slow">慢</button>
              <button class="speed-btn ${currentSpeed === 'normal' ? 'active' : ''}" data-speed="normal">正常</button>
              <button class="speed-btn ${currentSpeed === 'fast' ? 'active' : ''}" data-speed="fast">快</button>
              <button class="speed-btn ${currentSpeed === 'turbo' ? 'active' : ''}" data-speed="turbo">极速</button>
            </div>
          </div>
          <div class="speed-selector">
            <span class="speed-label">列表:</span>
            <div class="speed-buttons">
              <button class="speed-btn list-btn ${currentList === 'latest' ? 'active' : ''}" data-list="latest">最新</button>
              <button class="speed-btn list-btn ${currentList === 'new' ? 'active' : ''}" data-list="new">新帖</button>
              <button class="speed-btn list-btn ${currentList === 'unread' ? 'active' : ''}" data-list="unread">未读</button>
            </div>
          </div>
          <div class="speed-selector">
            <span class="speed-label">浏览:</span>
            <div class="speed-buttons">
              <button class="speed-btn browse-mode-btn ${currentBrowseMode === 'all' ? 'active' : ''}" data-mode="all">全部</button>
              <button class="speed-btn browse-mode-btn ${currentBrowseMode === 'posts' ? 'active' : ''}" data-mode="posts">楼层</button>
              <button class="speed-btn browse-mode-btn ${currentBrowseMode === 'time' ? 'active' : ''}" data-mode="time">时间</button>
              <button class="speed-btn browse-mode-btn ${currentBrowseMode === 'smart' ? 'active' : ''}" data-mode="smart">智能</button>
            </div>
          </div>
          <div class="speed-selector">
            <span class="speed-label">楼层:</span>
            <div class="speed-buttons">
              <button class="speed-btn post-limit-btn ${currentPostLimit === '20' ? 'active' : ''}" data-post-limit="20">20</button>
              <button class="speed-btn post-limit-btn ${currentPostLimit === '40' ? 'active' : ''}" data-post-limit="40">40</button>
              <button class="speed-btn post-limit-btn ${currentPostLimit === '80' ? 'active' : ''}" data-post-limit="80">80</button>
            </div>
          </div>
          <div class="speed-selector">
            <span class="speed-label">时间:</span>
            <div class="speed-buttons">
              <button class="speed-btn time-limit-btn ${currentTimeLimit === '30' ? 'active' : ''}" data-time-limit="30">30秒</button>
              <button class="speed-btn time-limit-btn ${currentTimeLimit === '60' ? 'active' : ''}" data-time-limit="60">60秒</button>
              <button class="speed-btn time-limit-btn ${currentTimeLimit === '120' ? 'active' : ''}" data-time-limit="120">120秒</button>
            </div>
          </div>
          <div class="speed-selector">
            <span class="speed-label">点赞:</span>
            <div class="speed-buttons">
              <button class="speed-btn like-btn ${enableLike ? 'active' : ''}" data-like="true">开启</button>
              <button class="speed-btn like-btn ${!enableLike ? 'active' : ''}" data-like="false">关闭</button>
            </div>
          </div>
          <div class="speed-selector">
            <span class="speed-label">点赞概率:</span>
            <div class="speed-buttons">
              <button class="speed-btn chance-btn ${currentLikeChance === 'low' ? 'active' : ''}" data-chance="low">低</button>
              <button class="speed-btn chance-btn ${currentLikeChance === 'medium' ? 'active' : ''}" data-chance="medium">中</button>
              <button class="speed-btn chance-btn ${currentLikeChance === 'high' ? 'active' : ''}" data-chance="high">高</button>
              <button class="speed-btn chance-btn ${currentLikeChance === 'veryHigh' ? 'active' : ''}" data-chance="veryHigh">极高</button>
            </div>
          </div>
          <button class="action-btn btn-start" id="btn-auto-start">开始自动浏览</button>
          <button class="action-btn btn-stop" id="btn-auto-stop" style="display:none;">停止运行</button>
          <button class="action-btn btn-clear" id="btn-clear-history">清除浏览记录</button>
          <div class="stats">
            <div class="stats-row">
              <span class="stats-label">状态</span>
              <span class="stats-value">
                <span class="status-indicator stopped" id="status-dot"></span>
                <span id="auto-status">未启动</span>
              </span>
            </div>
            <div class="stats-row">
              <span class="stats-label">总浏览帖子</span>
              <span class="stats-value" id="total-viewed">0</span>
            </div>
            <div class="stats-row">
              <span class="stats-label">总点赞</span>
              <span class="stats-value" id="total-liked">0</span>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(panel);
      this.panel = panel;

      this.restorePanelState();
      this.initPanelDrag();

      // 绑定事件
      document.getElementById('btn-auto-start').addEventListener('click', () => this.start());
      document.getElementById('btn-auto-stop').addEventListener('click', () => this.stop());
      document.getElementById('btn-minimize').addEventListener('click', () => this.toggleMinimize());
      document.getElementById('btn-clear-history').addEventListener('click', () => this.clearHistory());

      // 速度选择按钮事件
      document.querySelectorAll('.speed-btn[data-speed]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const speed = e.target.dataset.speed;
          setSpeed(speed);
          // 更新按钮状态
          document.querySelectorAll('.speed-btn[data-speed]').forEach(b => b.classList.remove('active'));
          e.target.classList.add('active');
        });
      });

      // 列表选择按钮事件
      document.querySelectorAll('.list-btn[data-list]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const list = e.target.dataset.list;
          setList(list);
          // 更新按钮状态
          document.querySelectorAll('.list-btn[data-list]').forEach(b => b.classList.remove('active'));
          e.target.classList.add('active');
        });
      });

      // 浏览模式按钮事件
      document.querySelectorAll('.browse-mode-btn[data-mode]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const mode = e.target.dataset.mode;
          setBrowseMode(mode);
          document.querySelectorAll('.browse-mode-btn[data-mode]').forEach(b => b.classList.remove('active'));
          e.target.classList.add('active');
        });
      });

      // 楼层数量按钮事件
      document.querySelectorAll('.post-limit-btn[data-post-limit]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const limit = e.target.dataset.postLimit;
          setPostLimit(limit);
          document.querySelectorAll('.post-limit-btn[data-post-limit]').forEach(b => b.classList.remove('active'));
          e.target.classList.add('active');
        });
      });

      // 时间限制按钮事件
      document.querySelectorAll('.time-limit-btn[data-time-limit]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const limit = e.target.dataset.timeLimit;
          setTimeLimit(limit);
          document.querySelectorAll('.time-limit-btn[data-time-limit]').forEach(b => b.classList.remove('active'));
          e.target.classList.add('active');
        });
      });

      // 点赞开关按钮事件
      document.querySelectorAll('.like-btn[data-like]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const enabled = e.target.dataset.like === 'true';
          setEnableLike(enabled);
          // 更新按钮状态
          document.querySelectorAll('.like-btn[data-like]').forEach(b => b.classList.remove('active'));
          e.target.classList.add('active');
        });
      });

      // 点赞概率按钮事件
      document.querySelectorAll('.chance-btn[data-chance]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const chance = e.target.dataset.chance;
          setLikeChance(chance);
          // 更新按钮状态
          document.querySelectorAll('.chance-btn[data-chance]').forEach(b => b.classList.remove('active'));
          e.target.classList.add('active');
        });
      });

    }

    toggleMinimize() {
      this.panel.classList.toggle('minimized');
      const minimized = this.panel.classList.contains('minimized');
      document.getElementById('btn-minimize').textContent = minimized ? '+' : '-';
      Storage.set('panel_minimized', minimized);
    }

    restorePanelState() {
      const pos = Storage.get('panel_position', null);

      if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
        this.panel.style.left = `${pos.left}px`;
        this.panel.style.top = `${pos.top}px`;
        this.panel.style.right = 'auto';
      }

      const minimized = Storage.get('panel_minimized', false);
      if (minimized) {
        this.panel.classList.add('minimized');
        const btn = document.getElementById('btn-minimize');
        if (btn) btn.textContent = '+';
      }
    }

    initPanelDrag() {
      const header = this.panel.querySelector('h3');
      if (!header) return;
    
      let dragging = false;
      let offsetX = 0;
      let offsetY = 0;
    
      const movePanel = (clientX, clientY) => {
        const maxLeft = window.innerWidth - this.panel.offsetWidth;
        const maxTop = window.innerHeight - this.panel.offsetHeight;
    
        const left = Math.max(0, Math.min(maxLeft, clientX - offsetX));
        const top = Math.max(0, Math.min(maxTop, clientY - offsetY));
    
        this.panel.style.left = `${left}px`;
        this.panel.style.top = `${top}px`;
        this.panel.style.right = 'auto';
      };
    
      header.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
    
        dragging = true;
    
        const rect = this.panel.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
    
        this.panel.style.left = `${rect.left}px`;
        this.panel.style.top = `${rect.top}px`;
        this.panel.style.right = 'auto';
    
        this.panel.classList.add('dragging');
        header.setPointerCapture(e.pointerId);
    
        e.preventDefault();
      });
    
      header.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        movePanel(e.clientX, e.clientY);
      });
    
      header.addEventListener('pointerup', (e) => {
        if (!dragging) return;
    
        dragging = false;
        this.panel.classList.remove('dragging');
    
        const rect = this.panel.getBoundingClientRect();
        Storage.set('panel_position', {
          left: Math.round(rect.left),
          top: Math.round(rect.top)
        });
    
        header.releasePointerCapture(e.pointerId);
      });
    
      header.addEventListener('pointercancel', () => {
        dragging = false;
        this.panel.classList.remove('dragging');
      });
    }

    updateStats() {
      const stats = this.history.getStats();
      document.getElementById('total-viewed').textContent = stats.totalViewed;
      document.getElementById('total-liked').textContent = stats.totalLiked;
    }

    async start() {
      this.isEnabled = true;
      Storage.set('auto_running', true);

      document.getElementById('btn-auto-start').style.display = 'none';
      document.getElementById('btn-auto-stop').style.display = 'block';
      document.getElementById('auto-status').textContent = '运行中';
      document.getElementById('status-dot').className = 'status-indicator running';

      // 启动卡住检测
      this.startStuckDetection();

      // 启动URL变化监听（处理SPA导航）
      this.startUrlWatcher();

      const pageType = getPageType();
      log(`当前页面: ${pageType}`);

      // 如果当前在列表页，先跳转到用户选择的列表类型
      if (pageType === 'list') {
        const targetListUrl = getListPathFor(currentList, window.location.pathname);
        if (window.location.pathname !== targetListUrl) {
          log(`切换到选择的列表: ${targetListUrl}`);
          Storage.set('last_list_path', targetListUrl);
          window.location.href = targetListUrl;
          return;
        }
      }

      try {
        if (pageType === 'topic') {
          // 重新创建实例并绑定心跳
          this.topicBrowser = new TopicBrowser(this.history, () => {
            this.updateStats();
            this.heartbeat();
          });
          await this.topicBrowser.start();
        } else if (pageType === 'list') {
          // 重新创建实例并绑定心跳
          this.listBrowser = new TopicListBrowser(this.history, () => {
            this.updateStats();
            this.heartbeat();
          });
          await this.listBrowser.start();
        } else {
          log('不支持的页面，跳转到列表');
          window.location.href = LIST_OPTIONS[currentList]?.path || '/latest';
        }
      } catch (error) {
        log('运行出错:', error.message);
        // 出错后等待一段时间再重试
        if (this.isEnabled) {
          log('5秒后自动重试...');
          document.getElementById('auto-status').textContent = '出错，重试中...';
          await randomDelay(5000, 8000);
          if (this.isEnabled) {
            log('重新开始...');
            this.restartBrowsing();
          }
        }
      }
    }

    stop() {
      this.isEnabled = false;
      Storage.set('auto_running', false);

      // 立即打断所有等待中的随机延迟
      cancelAllDelays();

      // 停止卡住检测
      this.stopStuckDetection();

      // 停止URL变化监听
      this.stopUrlWatcher();

      this.topicBrowser?.stop();
      this.listBrowser?.stop();

      document.getElementById('btn-auto-start').style.display = 'block';
      document.getElementById('btn-auto-stop').style.display = 'none';
      document.getElementById('auto-status').textContent = '已停止';
      document.getElementById('status-dot').className = 'status-indicator stopped';
    }

    clearHistory() {
      if (confirm('确定要清除所有浏览记录吗？这将允许重新浏览所有话题。')) {
        this.history.clearHistory();
        this.updateStats();
        alert('浏览记录已清除');
      }
    }
  }

  // ==================== 启动 ====================
  const automation = new LinuxDoAutomation();
  automation.init();

})();
