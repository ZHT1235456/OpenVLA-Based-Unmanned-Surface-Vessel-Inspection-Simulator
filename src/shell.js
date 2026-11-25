import './style.css';

const presets = [
  '去木栈桥旁的黄标拍照',
  '去浮标门的绿标拍照',
  '穿过红绿浮标门，只观察木栈桥旁的黄标，最后返回西泊位',
  '改去防波堤旁那座，栈桥留到回程',
  '返回东泊位',
];
const cleanupPresets = [
  ['只收塑料瓶','只收集塑料瓶'], ['只收泡沫块','只收集泡沫块'],
  ['全部清理','清理所有水面漂浮物'], ['双艇分工','A艇收集塑料瓶，B艇收集泡沫块']
];

const metrics = [
  ['speed', '航速', 'm/s'],
  ['heading', '航向', '°'],
  ['latency', '推理耗时', 'ms'],
  ['policy-rate', '推理频率', 'Hz'],
];

export function bindCommandInput(root, send) {
  const input = root.querySelector('#command');
  const preview = root.querySelector('#command-suggestion');
  const proposedText = root.querySelector('#suggestion-text');
  const shortcut = root.querySelector('#suggestion-key');
  const examples = [...presets, ...cleanupPresets.map(([,text])=>text), root.querySelector('#fleet-order').title, root.querySelector('.relay-order').dataset.fleetCommand];
  let correction = null;
  let composing = false;

  function suggestion() {
    if (composing) return '';
    const draft = input.value;
    if (!draft) return input.placeholder;
    if (correction?.draft === draft) return correction.text;
    const match = [input.placeholder, ...examples].find(text => text.startsWith(draft));
    return match && match !== draft ? match : '';
  }
  function refresh() {
    const text = suggestion();
    // In an empty editor the placeholder already shows the complete suggestion.
    const label = input.value ? text : '';
    if (proposedText.textContent !== label) proposedText.textContent = label;
    preview.hidden = !label;
    shortcut.hidden = !text;
    input.setAttribute('aria-describedby', label ? 'command-keys command-suggestion' : 'command-keys');
  }
  function edited() {
    correction = null;
    refresh();
  }
  input.addEventListener('input', edited);
  input.addEventListener('focus', refresh);
  input.addEventListener('compositionstart', () => { composing = true; refresh(); });
  input.addEventListener('compositionend', () => { composing = false; refresh(); });
  input.addEventListener('keydown', event => {
    if (event.defaultPrevented || composing || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const text = suggestion();
      if (!text) return;
      event.preventDefault();
      input.setRangeText(text, 0, input.value.length, 'end');
      input.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertReplacementText', data:text}));
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send(input.value);
    }
  });
  refresh();
  return {
    setValue(text) {
      input.value = text;
      edited();
    },
    offer(draft, text) {
      if (input.value.trim() !== draft) return;
      correction = text ? {draft:input.value, text} : null;
      refresh();
      if (correction && document.activeElement === root.querySelector('#send')) input.focus();
    },
    setDefault(text = presets[0]) {
      if (input.placeholder === text) return;
      input.placeholder = text;
      refresh();
    },
    clearCorrection: edited,
  };
}

function bindRecordTabs(root) {
  const tabList = root.querySelector('[role="tablist"]');
  const tabs = Array.from(tabList.querySelectorAll('[role="tab"]'));
  const activate = (tab) => {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      root.querySelector('#' + item.getAttribute('aria-controls')).hidden = !selected;
    }
  };

  tabList.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) activate(tab);
  });
  tabList.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(event.target);
    if (index < 0) return;
    const next = {
      ArrowLeft: (index + tabs.length - 1) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    activate(tabs[next]);
    tabs[next].focus();
  });
}

function bindPhotoPreview(root) {
  const photos = root.querySelector('#photos');
  const dialog = root.querySelector('.photo-preview');
  const enlarged = dialog.querySelector('img');
  const caption = dialog.querySelector('figcaption');
  const download = dialog.querySelector('.download-photo');
  const open = (thumbnail) => {
    enlarged.src = thumbnail.dataset.full || thumbnail.currentSrc || thumbnail.src;
    enlarged.alt = thumbnail.alt || '巡检照片';
    caption.textContent = thumbnail.closest('figure')?.querySelector('figcaption')?.textContent
      || thumbnail.alt || '巡检照片';
    download.href=enlarged.src;
    download.download='巡检照片-'+caption.textContent.replace(/[<>:"/\\|?*]/g,'-')+'.jpg';
    dialog.showModal();
  };
  photos.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.target.closest('a, [data-download]')) return;
    const thumbnail = event.target.closest('img') || event.target.closest('button')?.querySelector('img');
    if (thumbnail) open(thumbnail);
  });
  photos.addEventListener('keydown', (event) => {
    if (event.target.matches('img[tabindex]') && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      open(event.target);
    }
  });
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => enlarged.removeAttribute('src'));
}

export function mountShell(root) {
  root.innerHTML = `
    <div class="station">
      <header class="masthead">
        <div class="mast-identity">
          <div class="lab-mark" aria-label="汐航 Tideline">
            <svg class="wave-mark" viewBox="0 0 42 25" fill="none" aria-hidden="true"><path d="M2 9c6-1 9-6 15-5s9 7 15 5c3-1 5-3 8-4M2 17c6-1 9-6 15-5s9 7 15 5c3-1 5-3 8-4" stroke="currentColor" stroke-width="3.1" stroke-linecap="round"/></svg>
            <span class="callsign" lang="en">TIDELINE</span>
          </div>
          <h1><span class="title-unit">基于<span lang="en">OpenVLA</span>的</span><span class="title-unit">无人艇巡检模拟</span></h1>
        </div>
        <div class="mast-status">
          <span id="mode" class="mode-indicator" role="status">载入模型</span>
          <div class="session-timer" aria-label="仿真时长">
            <span class="timer-label">仿真时长</span>
            <time id="clock">00:00</time>
          </div>
          <button id="fullscreen" class="tool-button window-button" type="button" aria-label="切换全屏或窗口模式" title="切换全屏或窗口模式">窗口模式</button>
        </div>
      </header>

      <main class="station-grid">
        <section class="bridge" aria-label="港池巡检视图与遥测">
          <section class="scenic-instrument" aria-labelledby="scene-title">
          <div class="scene-window">
            <canvas id="world" width="960" height="540" aria-label="港池三维实时视图"></canvas>
            <div class="view-instruments">
              <h2 class="view-caption" id="scene-title"><span class="viewfinder" aria-hidden="true"></span>港池巡检</h2>
              <div class="view-controls">
                <button id="view" class="overlay-button camera-button" type="button" title="切换观察视角">切换视角</button>
                <button id="pause" class="overlay-button pause-button" type="button" aria-pressed="false" title="暂停或继续仿真">暂停</button>
              </div>
            </div>
          </div>

          <dl class="telemetry" aria-label="实时遥测">
            ${metrics.map(([id, title, unit]) => `
              <div class="metric">
                <dt>${title}</dt>
                <dd><span id="${id}">—</span><span class="metric-unit">${unit}</span></dd>
              </div>`).join('')}
          </dl>
          </section>

          <div class="instrument-pair">
            <section class="instrument chart-instrument" aria-labelledby="chart-title">
              <div class="instrument-heading">
                <h2 id="chart-title"><i class="chart-symbol" aria-hidden="true"></i>港池航迹</h2>
                <button id="compare" class="small-button compare-button" type="button" aria-pressed="false" title="对比本次与上次航迹">对比航迹</button>
              </div>
              <div class="instrument-screen"><canvas id="chart" width="440" height="170" aria-label="港池航迹俯视图"></canvas></div>
            </section>
            <section class="instrument bow-instrument" aria-labelledby="bow-title">
              <div class="instrument-heading">
                <h2 id="bow-title"><i class="camera-symbol" aria-hidden="true"></i>船首画面</h2>
              </div>
              <div class="instrument-screen"><canvas id="bow" width="320" height="180" aria-label="船首相机实时画面"></canvas></div>
            </section>
          </div>
        </section>

        <aside class="workbench" aria-labelledby="workbench-title" tabindex="-1">
          <div class="workbench-heading">
            <h2 id="workbench-title">指令工作台</h2>
          </div>

          <section class="command-section" aria-label="编队与指令输入">
            <div class="operating-fields">
              <label for="fleet-mode"><span>作业模式</span>
                <select id="fleet-mode">
                  <option value="single" selected>单艇巡检</option>
                  <option value="dual">双艇协作</option>
                </select>
              </label>
              <label for="follow-boat"><span>观察艇</span>
                <select id="follow-boat" disabled>
                  <option value="A" selected>A 艇</option>
                  <option value="B">B 艇</option>
                </select>
              </label>
            </div>
            <label class="field-label" for="command">指令输入</label>
            <textarea id="command" rows="2" spellcheck="false" placeholder="${presets[0]}" aria-describedby="command-keys"></textarea>
            <div id="command-suggestion" aria-live="polite" hidden><span>建议</span><span id="suggestion-text"></span></div>
            <div class="composer-actions">
              <small id="command-keys"><span id="suggestion-key"><kbd>Tab</kbd> 采纳建议</span><span><kbd>Enter</kbd> 发送</span><span><kbd>Shift+Enter</kbd> 换行</span></small>
              <button id="send" class="send-button" type="button">发送指令</button>
            </div>
            <details class="command-library">
              <summary>指令示例</summary>
              <div id="examples" class="presets">
                ${presets.map((command) => `<button type="button" data-command="${command}" title="${command}">${command}</button>`).join('')}
              </div>
            </details>
            <details class="command-library cleanup-library">
              <summary>水面清漂</summary>
              <div class="presets">
                ${cleanupPresets.map(([label,command])=>`<button type="button" data-command="${command}" title="${command}">${label}</button>`).join('')}
              </div>
            </details>
            <button id="fleet-order" class="fleet-order" type="button" title="双艇协作，分别巡检木栈桥和防波堤旁的黄标"><span class="fleet-symbol" aria-hidden="true"></span><span>分派两艇巡检</span><span class="order-arrow" aria-hidden="true">→</span></button>
          </section>

          <section class="fleet-panel" id="fleet-panel" aria-labelledby="fleet-title" hidden>
            <div class="section-heading">
              <h3 id="fleet-title">艇队状态</h3>
              <span id="link-status" role="status">等待链路</span>
            </div>
            <div id="fleet-roster" aria-label="各艇任务与状态"></div>
            <details class="fleet-comms">
              <summary>艇间报文</summary>
              <div id="fleet-messages" role="log" aria-live="off" data-empty="通信记录将显示在这里。"></div>
            </details>
            <button class="relay-order" type="button" data-fleet-command="接力复核，A艇拍摄栈桥黄标，B艇接力补拍" title="接力复核，A艇拍摄栈桥黄标，B艇接力补拍">接力拍照<span>A 艇首拍 · B 艇补拍</span></button>
          </section>

          <section class="mission-section" aria-label="巡检任务与记录">
            <div class="active-mission">
              <span class="mission-flag" aria-hidden="true"></span>
              <div>
                <h3>当前任务</h3>
                <p id="visible-task" role="status">等待巡检指令</p>
              </div>
            </div>
            <section id="cleanup-ledger" class="cleanup-ledger" aria-label="清漂收运" hidden>
              <div class="section-heading"><h3>清漂收运</h3><span id="cleanup-phase"></span></div>
              <dl>
                <div><dt>水面剩余</dt><dd id="cleanup-water">5</dd></div>
                <div><dt id="cleanup-cargo-label">A 艇船舱</dt><dd id="cleanup-cargo">0 / 2</dd></div>
                <div><dt>码头累计</dt><dd id="cleanup-land">0</dd></div>
              </dl>
              <p id="cleanup-detail"></p>
              <div class="shore-status">
                <span id="shore-state" role="status"></span>
                <button class="small-button" type="button" id="shore-view" aria-pressed="false">查看岸臂</button>
              </div>
            </section>
            <div class="record-tabs" role="tablist" aria-label="巡检记录">
              <button id="task-tab" role="tab" type="button" aria-controls="task-panel" aria-selected="true">任务队列</button>
              <button id="photo-tab" role="tab" type="button" aria-controls="photo-panel" aria-selected="false" tabindex="-1">巡检照片</button>
              <button id="log-tab" role="tab" type="button" aria-controls="log-panel" aria-selected="false" tabindex="-1">航行记录</button>
            </div>
            <div class="record-pane" id="task-panel" role="tabpanel" tabindex="0" aria-labelledby="task-tab">
              <div id="tasks" class="record-content" data-empty="提交指令后，待执行的步骤会显示在这里。"></div>
            </div>
            <div class="record-pane" id="photo-panel" role="tabpanel" tabindex="0" aria-labelledby="photo-tab" hidden>
              <div id="photos" class="record-content" data-empty="完成一次巡检拍照后，可在这里查看。"></div>
            </div>
            <div class="record-pane" id="log-panel" role="tabpanel" tabindex="0" aria-labelledby="log-tab" hidden>
              <div id="logs" class="record-content" data-empty="尚无航行记录。"></div>
            </div>
          </section>

          <section class="conditions" aria-labelledby="conditions-title">
            <div class="conditions-heading">
              <h3 id="conditions-title">试验条件</h3>
              <button id="reset" class="small-button reset-button" type="button" title="从当前试验条件的起点重跑">重置场景</button>
            </div>
            <div class="condition-fields">
              <label>港池布局
                <select id="layout">
                  <option value="0">标准布局</option>
                  <option value="1">镜像布局</option>
                  <option value="2">交错布局</option>
                </select>
              </label>
              <label>浮标状态
                <select id="condition">
                  <option value="tilt">持续倾斜</option>
                  <option value="normal">随浪回正</option>
                </select>
              </label>
            </div>
            <label class="traffic-toggle"><input id="traffic" type="checkbox" checked><span>保洁船穿行</span></label>
          </section>
        </aside>
      </main>
      <dialog class="photo-preview" aria-label="巡检照片大图">
        <figure>
          <div class="photo-preview-heading"><figcaption>巡检照片</figcaption><a class="small-button download-photo" download>保存原图</a><button class="small-button" type="button">关闭</button></div>
          <img alt="巡检照片">
        </figure>
      </dialog>
    </div>`;
  bindRecordTabs(root);
  bindPhotoPreview(root);
  return root;
}
