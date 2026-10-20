// Expand a briefing into printable timeline keyframes without mutating it.
export function timelinePdfFrames(slides = []) {
  const result = [];
  for (const slide of slides.filter(item => !item.hidden)) {
    if (Array.isArray(slide.timeline?.frames) && slide.timeline.frames.length) {
      slide.timeline.frames.forEach((frame,index) => result.push({slideId:slide.id,index,title:frame.title}));
    } else if (slide.generatedBy?.template === 'timeline') result.push({slideId:slide.id,index:null,title:slide.title});
  }
  return result;
}
export function parseTimelineFrameSelection(input, count) {
  if (!String(input ?? '').trim()) throw new Error('Choose at least one timeline frame.');
  const selected = new Set();
  for (const part of String(input).split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) throw new Error('Use frame numbers or ranges separated by commas, for example 1,3-5.');
    const start=Number(match[1]), end=Number(match[2] || match[1]);
    if (start < 1 || end < start || end > count) throw new Error(`Frame numbers must be between 1 and ${count}.`);
    for (let n=start; n<=end; n++) selected.add(n-1);
  }
  return [...selected].sort((a,b)=>a-b);
}
export function expandTimelinePdfSlides(slides = [], {mode = 'initial', selected = []} = {}) {
  if (!['initial','all','selected'].includes(mode)) throw new Error('Unknown PDF timeline frame option.');
  const frames = timelinePdfFrames(slides);
  const selectedSet = new Set(selected);
  if (mode === 'selected' && (!selectedSet.size || [...selectedSet].some(n => !Number.isInteger(n) || n < 0 || n >= frames.length))) throw new Error('Choose valid timeline frames to export.');
  let ordinal=0;
  const result=[];
  for (const slide of slides.filter(item => !item.hidden)) {
    const inline = Array.isArray(slide.timeline?.frames) && slide.timeline.frames.length;
    if (inline) {
      if (mode === 'initial') { result.push(slide); ordinal += slide.timeline.frames.length; continue; }
      for (const frame of slide.timeline.frames) {
        const include = mode === 'all' || selectedSet.has(ordinal);
        ordinal++;
        if (include) result.push({...slide, title:`${slide.title} — ${frame.title}`, frameNarrative:frame.narrative || '', dataView:{...slide.dataView,filter:frame.filter}});
      }
    } else if (slide.generatedBy?.template === 'timeline') {
      if (mode !== 'selected' || selectedSet.has(ordinal)) result.push(slide);
      ordinal++;
    } else result.push(slide);
  }
  return result;
}
