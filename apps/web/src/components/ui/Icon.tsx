interface Props {
  name: IconName;
  size?: number;
  stroke?: number;
  className?: string;
  style?: React.CSSProperties;
}

export type IconName =
  | 'home' | 'users' | 'shield' | 'menu' | 'x' | 'plus' | 'minus' | 'check'
  | 'chevronDown' | 'chevronUp' | 'chevronLeft' | 'chevronRight'
  | 'search' | 'upload' | 'download' | 'trash' | 'settings'
  | 'folder' | 'fileText'
  | 'image' | 'camera' | 'play' | 'pause' | 'logout' | 'user' | 'key' | 'copy'
  | 'info' | 'alert' | 'polaroid' | 'filter' | 'sort' | 'share'
  | 'video' | 'userPlus' | 'userCheck' | 'userX' | 'lock' | 'mail'
  | 'ticket' | 'clock' | 'cake' | 'drag' | 'select' | 'more'
  | 'expand' | 'checkCircle' | 'bell' | 'mapPin' | 'aperture' | 'mountain'
  | 'history' | 'pencil' | 'calendar' | 'map' | 'sparkles' | 'dotsVertical'
  | 'palette' | 'eye' | 'chartBar' | 'crown' | 'infoCircle' | 'alertTriangle';

export default function Icon({ name, size = 20, stroke = 1.6, className, style }: Props) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: stroke,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    style,
  };
  switch (name) {
    case 'home': return <svg {...props}><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>;
    case 'users': return <svg {...props}><circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M3 19c0-3 2.5-5 6-5s6 2 6 5"/><path d="M15.5 19c.2-2 1.5-3.5 4-3.5"/></svg>;
    case 'shield': return <svg {...props}><path d="M12 3l8 3v6c0 4-3.5 7.5-8 9-4.5-1.5-8-5-8-9V6l8-3z"/></svg>;
    case 'menu': return <svg {...props}><path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/></svg>;
    case 'x': return <svg {...props}><path d="M5 5l14 14"/><path d="M19 5L5 19"/></svg>;
    case 'plus': return <svg {...props}><path d="M12 5v14"/><path d="M5 12h14"/></svg>;
    case 'minus': return <svg {...props}><path d="M5 12h14"/></svg>;
    case 'check': return <svg {...props}><path d="M4 12l5 5L20 6"/></svg>;
    case 'chevronDown': return <svg {...props}><path d="M6 9l6 6 6-6"/></svg>;
    case 'chevronUp': return <svg {...props}><path d="M6 15l6-6 6 6"/></svg>;
    case 'chevronLeft': return <svg {...props}><path d="M15 6l-6 6 6 6"/></svg>;
    case 'chevronRight': return <svg {...props}><path d="M9 6l6 6-6 6"/></svg>;
    case 'search': return <svg {...props}><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg>;
    case 'upload': return <svg {...props}><path d="M12 4v12"/><path d="M7 9l5-5 5 5"/><path d="M5 20h14"/></svg>;
    case 'download': return <svg {...props}><path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/></svg>;
    case 'trash': return <svg {...props}><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>;
    case 'settings': return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>;
    case 'folder': return <svg {...props}><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2.5h7A2.5 2.5 0 0 1 21 10v6.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9z"/></svg>;
    case 'fileText': return <svg {...props}><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 12h6"/><path d="M9 16h6"/><path d="M9 20h3"/></svg>;
    case 'image': return <svg {...props}><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M3 17l5-5 4 4 3-3 6 6"/></svg>;
    case 'camera': return <svg {...props}><path d="M5 8h2l1.5-2h7L17 8h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"/><circle cx="12" cy="13" r="4"/></svg>;
    case 'play': return <svg {...props} fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>;
    case 'pause': return <svg {...props} fill="currentColor" stroke="none"><path d="M7 5h4v14H7z"/><path d="M13 5h4v14h-4z"/></svg>;
    case 'logout': return <svg {...props}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>;
    case 'user': return <svg {...props}><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>;
    case 'key': return <svg {...props}><circle cx="8" cy="14" r="4"/><path d="M11 12l8-8"/><path d="M16 5l3 3"/></svg>;
    case 'copy': return <svg {...props}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>;
    case 'info': return <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r="1" fill="currentColor"/></svg>;
    case 'alert': return <svg {...props}><path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5"/><circle cx="12" cy="18" r=".5" fill="currentColor"/></svg>;
    case 'polaroid': return <svg {...props}><rect x="4" y="3" width="16" height="18" rx="2"/><rect x="6" y="5" width="12" height="11"/><circle cx="9" cy="10" r="1.5"/><path d="M6 14l3-3 4 4 2-2 3 3"/></svg>;
    case 'filter': return <svg {...props}><path d="M3 5h18l-7 9v6l-4-2v-4L3 5z"/></svg>;
    case 'sort': return <svg {...props}><path d="M7 4v16"/><path d="M4 7l3-3 3 3"/><path d="M17 20V4"/><path d="M14 17l3 3 3-3"/></svg>;
    case 'share': return <svg {...props}><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 11l7-4"/><path d="M8.5 13l7 4"/></svg>;
    case 'video': return <svg {...props}><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></svg>;
    case 'userPlus': return <svg {...props}><circle cx="9" cy="8" r="4"/><path d="M3 21c0-4 3-6 6-6s6 2 6 6"/><path d="M19 8v6"/><path d="M16 11h6"/></svg>;
    case 'userCheck': return <svg {...props}><circle cx="9" cy="8" r="4"/><path d="M3 21c0-4 3-6 6-6s6 2 6 6"/><path d="M16 12l2 2 4-4"/></svg>;
    case 'userX': return <svg {...props}><circle cx="9" cy="8" r="4"/><path d="M3 21c0-4 3-6 6-6s6 2 6 6"/><path d="M17 10l5 5"/><path d="M22 10l-5 5"/></svg>;
    case 'lock': return <svg {...props}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>;
    case 'mail': return <svg {...props}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 7 9-7"/></svg>;
    case 'ticket': return <svg {...props}><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V8z"/><path d="M9 6v12" strokeDasharray="2 2"/></svg>;
    case 'clock': return <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case 'cake': return <svg {...props}><path d="M4 21h16"/><rect x="4" y="12" width="16" height="6" rx="2"/><path d="M8 12V8"/><path d="M12 12V7"/><path d="M16 12V8"/><circle cx="8" cy="6" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="16" cy="6" r="1"/></svg>;
    case 'drag': return <svg {...props}><circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/></svg>;
    case 'select': return <svg {...props}><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 12l2 2 4-4"/></svg>;
    case 'more': return <svg {...props}><circle cx="6" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="18" cy="12" r="1.5" fill="currentColor"/></svg>;
    case 'expand': return <svg {...props}><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>;
    case 'checkCircle': return <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>;
    case 'bell': return <svg {...props}><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2.5h-15L6 16z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>;
    case 'mapPin': return <svg {...props}><path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/></svg>;
    case 'aperture': return <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M12 3v9l8 4"/><path d="M12 21V12L4 8"/><path d="M3.5 16L12 12l8.5 4"/></svg>;
    case 'mountain': return <svg {...props}><path d="M3 20l6-10 4 6 3-4 5 8H3z"/></svg>;
    case 'history': return <svg {...props}><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/></svg>;
    case 'pencil': return <svg {...props}><path d="M14 4l6 6-10 10H4v-6L14 4z"/><path d="M13 5l6 6"/></svg>;
    case 'calendar': return <svg {...props}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/></svg>;
    case 'map': return <svg {...props}><path d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14"/><path d="M15 6v14"/></svg>;
    case 'sparkles': return <svg {...props}><path d="M12 3l1.8 4.7L18 9.5l-4.2 1.8L12 16l-1.8-4.7L6 9.5l4.2-1.8L12 3z"/><path d="M19 14l.9 2.3L22 17l-2.1.7L19 20l-.9-2.3L16 17l2.1-.7L19 14z"/><path d="M5 15l.6 1.5L7 17l-1.4.5L5 19l-.6-1.5L3 17l1.4-.5L5 15z"/></svg>;
    case 'dotsVertical': return <svg {...props}><circle cx="12" cy="6" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="18" r="1.5" fill="currentColor"/></svg>;
    case 'palette': return <svg {...props}><path d="M12 3a9 9 0 1 0 0 18c1.6 0 2-1.4 1-2.5-1-1.1-.6-2.5 1-2.5h1.5a3.5 3.5 0 0 0 3.5-3.5C19 8 16 4 12 4z"/><circle cx="7.5" cy="10.5" r="1" fill="currentColor"/><circle cx="12" cy="7.5" r="1" fill="currentColor"/><circle cx="16.5" cy="10.5" r="1" fill="currentColor"/></svg>;
    case 'eye': return <svg {...props}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>;
    case 'chartBar': return <svg {...props}><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-8"/><path d="M22 20H2"/></svg>;
    case 'crown': return <svg {...props}><path d="M3 17l2-10 5 5 2-7 2 7 5-5 2 10z"/><path d="M3 20h18"/></svg>;
    case 'infoCircle': return <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r="1" fill="currentColor"/></svg>;
    case 'alertTriangle': return <svg {...props}><path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5"/><circle cx="12" cy="18" r=".5" fill="currentColor"/></svg>;
    default: return null;
  }
}
