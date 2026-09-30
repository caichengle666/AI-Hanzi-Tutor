export function playAudio(text, targetVoiceURI = 'auto', retryCount = 0, languagePrefix = 'zh', onEnd) {
  const content = String(text || '');
  if (!('speechSynthesis' in window)) {
    if (window.responsiveVoice) {
      window.responsiveVoice.speak(content, languagePrefix === 'en' ? 'US English Female' : 'Chinese Female', {
        rate: 0.85,
        onend: onEnd
      });
    } else if (onEnd) {
      setTimeout(onEnd, 0);
    }
    return;
  }

  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(content);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (onEnd) onEnd();
  };
  utter.onend = finish;
  utter.onerror = finish;

  const pickVoice = (voices) => {
    let selectedVoice = null;
    if (targetVoiceURI && targetVoiceURI !== 'auto') {
      selectedVoice = voices.find(v => v.voiceURI === targetVoiceURI);
    }
    if (!selectedVoice) {
      const preferredVoices = voices.filter(v => (v.lang || '').toLowerCase().includes(languagePrefix.toLowerCase()));
      selectedVoice = preferredVoices.find(v => v.name.includes('Siri') || v.name.includes('Enhanced'));
      if (!selectedVoice) selectedVoice = preferredVoices.find(v => v.name.includes('Google') || v.name.includes('Microsoft'));
      if (!selectedVoice) selectedVoice = preferredVoices[0];
    }
    if (selectedVoice) {
      utter.voice = selectedVoice;
      utter.lang = selectedVoice.lang;
      console.log("🔊 使用语音:", selectedVoice.name);
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      utter.rate = languagePrefix === 'en' ? (isIOS ? 0.78 : 0.82) : (isIOS ? 0.85 : 0.9);
      utter.pitch = 1.05;
    }
    window.speechSynthesis.speak(utter);
    // 兜底：某些平台不触发 onend，按文本长度估算一个上限
    const fallbackMs = Math.min(20000, Math.max(6000, content.length * 600));
    setTimeout(finish, fallbackMs);
  };

  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    pickVoice(voices);
    return;
  }
  // 语音列表还没加载完时等待 voiceschanged，用 addEventListener 避免覆盖别人的 handler
  let waited = false;
  const handler = () => {
    waited = true;
    window.speechSynthesis.removeEventListener('voiceschanged', handler);
    pickVoice(window.speechSynthesis.getVoices());
  };
  window.speechSynthesis.addEventListener('voiceschanged', handler);
  setTimeout(() => {
    if (!waited) {
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
      pickVoice(window.speechSynthesis.getVoices());
    }
  }, 1500);
}
