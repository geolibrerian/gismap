// Client-side, unsigned legends. A link is a keepsake, not proof of a score.
(() => {
  'use strict';
  const MAX_NAME = 32, MAX_SCORE = 1000000;
  const cleanName = (value) => Array.from(String(value || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()).slice(0, MAX_NAME).join('');
  const validNumber = (value) => /^\d{1,7}$/.test(value || '') && Number(value) <= MAX_SCORE;
  const beats = (result, target) => Boolean(target && (result.score > target.score || (result.score === target.score && result.distance > target.distance)));
  const parse = (href) => {
    try {
      const p = new URL(href).searchParams;
      if (p.get('legend') !== '1' || !validNumber(p.get('maidens')) || !validNumber(p.get('distance'))) return null;
      const name = cleanName(p.get('name'));
      if (!name) return null;
      const result = { name, score: Number(p.get('maidens')), distance: Number(p.get('distance')) };
      if (cleanName(p.get('beaten')) && validNumber(p.get('beatenMaidens')) && validNumber(p.get('beatenDistance'))) {
        const target = { name: cleanName(p.get('beaten')), score: Number(p.get('beatenMaidens')), distance: Number(p.get('beatenDistance')) };
        if (beats(result, target)) result.beaten = target;
      }
      return result;
    } catch { return null; }
  };
  const linkFor = (origin, result) => {
    const url = new URL('/dragons/', origin);
    const params = new URLSearchParams({ legend: '1', name: cleanName(result.name), maidens: String(result.score), distance: String(result.distance) });
    if (result.beaten && beats(result, result.beaten)) {
      params.set('beaten', cleanName(result.beaten.name));
      params.set('beatenMaidens', String(result.beaten.score));
      params.set('beatenDistance', String(result.beaten.distance));
    }
    url.search = params;
    return url.href;
  };
  const storyFor = ({ name, score, distance, beaten }) => {
    const dragon = cleanName(name) || 'THE NAMELESS DRAGON';
    const triumph = beaten && beats({score, distance}, beaten) ? `\n\nAND LO! ${dragon.toUpperCase()} SURPASSED THE LEGEND OF ${cleanName(beaten.name).toUpperCase()}, WHOSE SCORE WAS ${beaten.score} MAIDENS AND ${beaten.distance} LEAGUES. THE ROYAL SCOREKEEPER DROPPED HIS QUILL.` : '';
    return `HEAR YE, HEAR YE!\n\nWE, THE BRAVE KNIGHTS OF THE REALM, FINALLY SLEW ${dragon.toUpperCase()}!\n\nTHE BEAST CROSSED ${distance} LEAGUES, OUTWITTING SERPENTS, KRAKENS, AND AN ALARMING NUMBER OF LANCES.\n\nWE LOST ${score} ${score === 1 ? 'MAIDEN' : 'MAIDENS'} TO THE BEAST. WE SHALL BE DISCUSSING THIS WITH THE CASTLE GUARDS.${triumph}\n\nAT LAST WE TRIUMPHED! (THE DRAGON MAY ALSO HAVE HIT THE GROUND.)\n\nTHUS ENDS THE LEGEND. INSERT ANOTHER ADVENTURE?`;
  };
  const story = document.querySelector('#legendStory'), scroll = document.querySelector('#legendScroll'), scoreText = document.querySelector('#legendScore'), shareButton = document.querySelector('#shareResults'), banner = document.querySelector('#challengeBanner');
  const dialog = document.querySelector('#shareDialog'), form = document.querySelector('#shareForm'), nameInput = document.querySelector('#dragonName'), close = document.querySelector('#shareClose');
  const output = document.querySelector('#shareOutput'), qr = document.querySelector('#shareQr'), link = document.querySelector('#shareLink'), status = document.querySelector('#shareStatus'), copy = document.querySelector('#copyLink'), download = document.querySelector('#downloadQr');
  const recordDialog = document.querySelector('#recordDialog'), recordForm = document.querySelector('#recordForm'), recordName = document.querySelector('#recordName'), recordScore = document.querySelector('#recordScore');
  let current = null, pendingRecord = null;
  function record(result, onComplete) {
    pendingRecord = { result, onComplete };
    recordName.value = '';
    recordName.setCustomValidity('');
    recordScore.textContent = `Maidens ${result.score} · Distance ${Math.floor(result.distance)} leagues`;
    recordDialog.showModal();
    recordName.focus();
  }
  recordForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!pendingRecord) return;
    const name = cleanName(recordName.value);
    if (!name) { recordName.setCustomValidity('Enter a dragon name.'); recordName.reportValidity(); return; }
    recordName.setCustomValidity('');
    const { result, onComplete } = pendingRecord;
    pendingRecord = null;
    recordDialog.close();
    onComplete({ ...result, name });
  });
  recordName.addEventListener('input', () => recordName.setCustomValidity(''));
  // Keep the game-over flow reachable even when the browser sends Escape.
  recordDialog.addEventListener('cancel', (event) => event.preventDefault());
  const challengeMessage = (target) => `The famous dragon ${cleanName(target.name)} has taken ${target.score} ${target.score === 1 ? 'maiden' : 'maidens'} and flown ${target.distance} ${target.distance === 1 ? 'league' : 'leagues'} — can you beat ${cleanName(target.name)}?`;
  function setChallenge(target) {
    if (!target) { banner.hidden = true; banner.textContent = ''; return; }
    banner.hidden = false;
    banner.textContent = `${challengeMessage(target)} More maidens wins; distance breaks a tie.`;
  }
  function show(result) {
    current = { name: cleanName(result.name), score: Math.max(0, Math.min(MAX_SCORE, Math.floor(result.score))), distance: Math.max(0, Math.min(MAX_SCORE, Math.floor(result.distance))), beaten: result.beaten || null };
    story.textContent = storyFor(current); scoreText.textContent = `MAIDENS ${current.score} · DISTANCE ${current.distance} LEAGUES`;
    scroll.hidden = false; scoreText.hidden = false; shareButton.hidden = false;
  }
  function hide() { scroll.hidden = true; scoreText.hidden = true; shareButton.hidden = true; }
  // Draw the QR into its own undisturbed white square. The illustration and
  // border stay outside its four-module quiet zone so scanners can read it.
  function decorateQr(source, canvas) {
    canvas.width = 600; canvas.height = 760;
    const c = canvas.getContext('2d');
    c.fillStyle = '#f6edcf'; c.fillRect(0, 0, 600, 760);
    c.strokeStyle = '#486d58'; c.lineWidth = 4; c.strokeRect(15, 15, 570, 730);
    c.strokeStyle = '#c3934d'; c.lineWidth = 2; c.strokeRect(25, 25, 550, 710);
    c.textAlign = 'center'; c.fillStyle = '#204d40'; c.font = 'bold 24px Georgia, serif'; c.fillText('HERE BE DRAGONS', 300, 69);
    c.font = 'bold 15px monospace'; c.fillText('A CHALLENGE FROM THE REALM', 300, 99);
    c.fillStyle = '#fff'; c.fillRect(76, 156, 448, 448);
    c.imageSmoothingEnabled = false; c.drawImage(source, 80, 160, 440, 440);
    // A little sea dragon curls around the lower border, as on an old chart.
    c.strokeStyle = '#215748'; c.lineWidth = 9; c.lineCap = 'round'; c.beginPath(); c.moveTo(76, 684); c.bezierCurveTo(110, 653, 140, 717, 178, 686); c.bezierCurveTo(195, 673, 185, 655, 197, 644); c.stroke();
    c.fillStyle = '#4c9274'; c.strokeStyle = '#215748'; c.lineWidth = 3; c.beginPath(); c.moveTo(167, 686); c.lineTo(145, 651); c.lineTo(176, 664); c.lineTo(190, 638); c.lineTo(194, 681); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(190, 647); c.lineTo(205, 633); c.lineTo(217, 640); c.lineTo(211, 648); c.lineTo(198, 651); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#f6edcf'; c.beginPath(); c.arc(208, 640, 2, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#245245'; c.font = 'bold 18px monospace'; c.textAlign = 'center'; c.fillText('CAN YOU BEAT THE DRAGON?', 380, 691);
    c.fillStyle = '#a27a3f'; c.font = '14px Georgia, serif'; c.fillText('gismap.online/dragons', 300, 721);
  }
  shareButton.addEventListener('click', () => { if (!current) return; nameInput.value = current.name; output.hidden = true; status.textContent = ''; dialog.showModal(); nameInput.focus(); });
  close.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = cleanName(nameInput.value);
    if (!name) { nameInput.setCustomValidity('Enter a dragon name.'); nameInput.reportValidity(); return; }
    nameInput.setCustomValidity('');
    show({ ...current, name });
    const href = linkFor('https://gismap.online', current);
    link.href = href; link.textContent = href; output.hidden = false; status.textContent = ''; download.hidden = true;
    try {
      if (!globalThis.QRCode?.toCanvas) throw new Error('QR code generator unavailable');
      const plain = document.createElement('canvas');
      await globalThis.QRCode.toCanvas(plain, href, { width: 440, margin: 4, errorCorrectionLevel: 'M' });
      decorateQr(plain, qr);
      qr.hidden = false; download.href = qr.toDataURL('image/png'); download.hidden = false;
    } catch { qr.hidden = true; status.textContent = 'QR code unavailable; you can still use the link.'; }
  });
  nameInput.addEventListener('input', () => { nameInput.setCustomValidity(''); output.hidden = true; status.textContent = ''; });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link.href); status.textContent = 'Link copied.'; }
    catch { status.textContent = 'Copy the link above from your browser.'; }
  });
  globalThis.DragonResults = { parse, linkFor, storyFor, beats, challengeMessage, setChallenge, record, show, hide };
})();
