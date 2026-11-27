/**
 * 10 handcrafted visual & color styles for Sobosuba.
 * Every value (1, 2, 4 ... 16384+) maps to a curated jelly gradient pair + legible text color.
 */

export const SOBO_STYLES = [
  {
    id: 'classic',
    name: '经典果冻',
    subtitle: '暗夜纯色高对比果冻',
    pageBg: '#16171D',
    pageText: '#F5F6FA',
    boardBg: '#2E3039',
    boardInner: '#08090D',
    boardBorder: 'rgba(255, 255, 255, 0.14)',
    barLine: 'rgba(255, 255, 255, 0.34)',
    barTrack: 'rgba(255, 255, 255, 0.10)',
    rayFill: '#B9C2D6',
    bumperIdle: 'rgba(255, 255, 255, 0.18)',
    bumperWarn: '#FFB84D',
    bumperDanger: '#FF4E78',
    arrowSoft: '#6EE7B7',
    arrowMid: '#FBBF24',
    arrowHard: '#FB7185',
    eyeColor: 'rgba(24, 18, 32, 0.84)',
    glossAlpha: 0.42,
    swatches: ['#FF6B97', '#FFB84D', '#5CE1E6', '#A78BFA'],
    palette: [
      ['#78B7FF', '#4C8CE6', '#FFFFFF'], // 1
      ['#6FE3C1', '#38B894', '#16362C'], // 2
      ['#FFE066', '#E8B828', '#4A3800'], // 4
      ['#FFA96B', '#E57935', '#FFFFFF'], // 8
      ['#FF779C', '#E04672', '#FFFFFF'], // 16
      ['#C88BFF', '#9553E0', '#FFFFFF'], // 32
      ['#69E2FF', '#2AAFD6', '#0A3342'], // 64
      ['#FF637D', '#D92B4B', '#FFFFFF'], // 128
      ['#8AF27A', '#4AC73A', '#133B0E'], // 256
      ['#FFB84D', '#DB8214', '#FFFFFF'], // 512
      ['#FF5CD6', '#C928A0', '#FFFFFF'], // 1024
      ['#738BFF', '#415BE0', '#FFFFFF'], // 2048
      ['#FFE97D', '#E8A817', '#3D2700'], // 4096
      ['#FFFFFF', '#D8E3FF', '#242947'], // 8192+
    ],
  },
  {
    id: 'sakura',
    name: '樱花草莓',
    subtitle: '粉嫩少女甜心果冻',
    pageBg: '#FFF0F5',
    pageText: '#4A2535',
    boardBg: '#FFE4EE',
    boardInner: '#FFF7FA',
    boardBorder: 'rgba(224, 114, 152, 0.28)',
    barLine: 'rgba(214, 102, 144, 0.30)',
    barTrack: 'rgba(214, 102, 144, 0.12)',
    rayFill: '#FF7EA8',
    bumperIdle: 'rgba(214, 102, 144, 0.25)',
    bumperWarn: '#FF9E64',
    bumperDanger: '#F43F5E',
    arrowSoft: '#F472B6',
    arrowMid: '#FB923C',
    arrowHard: '#E11D48',
    eyeColor: 'rgba(74, 30, 48, 0.82)',
    glossAlpha: 0.52,
    swatches: ['#FF9EBB', '#FFC2D1', '#FF759F', '#FFB5A7'],
    palette: [
      ['#FFD1DC', '#F7A8BE', '#6B2A42'], // 1
      ['#FFBAC9', '#F08CA5', '#6B2038'], // 2
      ['#FFB5A7', '#F28A79', '#5E231A'], // 4
      ['#FF99B8', '#E6678E', '#FFFFFF'], // 8
      ['#FF80A5', '#DE4E78', '#FFFFFF'], // 16
      ['#E89BE8', '#C468C4', '#FFFFFF'], // 32
      ['#FFA78A', '#E67350', '#FFFFFF'], // 64
      ['#FF6694', '#D93466', '#FFFFFF'], // 128
      ['#C89BFF', '#9B65E3', '#FFFFFF'], // 256
      ['#FF5484', '#C92254', '#FFFFFF'], // 512
      ['#FFD166', '#E59F1E', '#4F3000'], // 1024
      ['#FF3D7F', '#BA1651', '#FFFFFF'], // 2048
      ['#A87BFF', '#6F3DE0', '#FFFFFF'], // 4096
      ['#FFF0F6', '#F9C6DC', '#701A3E'], // 8192+
    ],
  },
  {
    id: 'cream',
    name: '奶油布丁',
    subtitle: '清新明朗白底配色',
    pageBg: '#F9F5EE',
    pageText: '#2E2A26',
    boardBg: '#EFE8DC',
    boardInner: '#FFFFFF',
    boardBorder: 'rgba(70, 56, 40, 0.14)',
    barLine: 'rgba(70, 56, 40, 0.20)',
    barTrack: 'rgba(70, 56, 40, 0.08)',
    rayFill: '#F59E0B',
    bumperIdle: 'rgba(70, 56, 40, 0.18)',
    bumperWarn: '#F59E0B',
    bumperDanger: '#EF4444',
    arrowSoft: '#34D399',
    arrowMid: '#F59E0B',
    arrowHard: '#EF4444',
    eyeColor: 'rgba(46, 36, 28, 0.84)',
    glossAlpha: 0.48,
    swatches: ['#FF9F68', '#60C5F1', '#8CD790', '#F7C948'],
    palette: [
      ['#8ED8F8', '#5BB5E3', '#15445E'], // 1
      ['#9CE3A8', '#68C479', '#194D23'], // 2
      ['#FFE07A', '#E8BC35', '#523F05'], // 4
      ['#FFB078', '#EA833F', '#FFFFFF'], // 8
      ['#FF8FA3', '#E35D77', '#FFFFFF'], // 16
      ['#BFA2FF', '#916CE6', '#FFFFFF'], // 32
      ['#69D9D0', '#34B3AA', '#0D4540'], // 64
      ['#FF7070', '#DE4040', '#FFFFFF'], // 128
      ['#F9B949', '#D68E1A', '#FFFFFF'], // 256
      ['#E879F9', '#C044D4', '#FFFFFF'], // 512
      ['#6385FF', '#3A5CE0', '#FFFFFF'], // 1024
      ['#FF5C8D', '#CC295C', '#FFFFFF'], // 2048
      ['#4ADE80', '#16A34A', '#FFFFFF'], // 4096
      ['#38332E', '#1C1917', '#FFE58F'], // 8192+
    ],
  },
  {
    id: 'milk_tea',
    name: '珍珠奶茶',
    subtitle: '焦糖燕麦芋泥暖棕系',
    pageBg: '#F6EDE4',
    pageText: '#432F24',
    boardBg: '#EBDCCB',
    boardInner: '#FAF4EC',
    boardBorder: 'rgba(110, 74, 48, 0.18)',
    barLine: 'rgba(110, 74, 48, 0.24)',
    barTrack: 'rgba(110, 74, 48, 0.09)',
    rayFill: '#C98A5B',
    bumperIdle: 'rgba(110, 74, 48, 0.22)',
    bumperWarn: '#D9822B',
    bumperDanger: '#D1493B',
    arrowSoft: '#B08968',
    arrowMid: '#D9822B',
    arrowHard: '#B83B2E',
    eyeColor: 'rgba(54, 34, 22, 0.85)',
    glossAlpha: 0.44,
    swatches: ['#E6CCB2', '#DDB892', '#B08968', '#D3B8E8'],
    palette: [
      ['#F2DEC8', '#DEC0A0', '#5C402C'], // 1
      ['#E8C6A2', '#CFA074', '#4F321E'], // 2
      ['#DEC7EA', '#BA9ACC', '#432A52'], // 4 (芋泥)
      ['#E5B285', '#C78A56', '#FFFFFF'], // 8
      ['#D6986A', '#B26F41', '#FFFFFF'], // 16
      ['#B8CE9E', '#8EA870', '#2B3E18'], // 32 (抹茶奶盖)
      ['#C9876B', '#A36044', '#FFFFFF'], // 64
      ['#E8A0A0', '#C47272', '#FFFFFF'], // 128 (草莓牛奶)
      ['#A67353', '#7D4E31', '#FFFFFF'], // 256 (焦糖)
      ['#8C5D43', '#633B25', '#FFFFFF'], // 512 (黑糖)
      ['#F2C97D', '#D19D41', '#4A3106'], // 1024 (布丁)
      ['#6E4736', '#4A2C1F', '#FFE4C4'], // 2048 (珍珠)
      ['#A87AC9', '#7B4E9E', '#FFFFFF'], // 4096
      ['#422C22', '#261710', '#FFE0A3'], // 8192+
    ],
  },
  {
    id: 'matcha',
    name: '宇治抹茶',
    subtitle: '治愈森系青柠与奶油',
    pageBg: '#EFF5EC',
    pageText: '#233828',
    boardBg: '#DFEBDA',
    boardInner: '#F7FBF5',
    boardBorder: 'rgba(56, 98, 62, 0.18)',
    barLine: 'rgba(56, 98, 62, 0.24)',
    barTrack: 'rgba(56, 98, 62, 0.09)',
    rayFill: '#5FAF6B',
    bumperIdle: 'rgba(56, 98, 62, 0.20)',
    bumperWarn: '#EAB308',
    bumperDanger: '#E05A47',
    arrowSoft: '#65B874',
    arrowMid: '#D9A036',
    arrowHard: '#DC4E41',
    eyeColor: 'rgba(26, 46, 30, 0.85)',
    glossAlpha: 0.45,
    swatches: ['#B7E4C7', '#74C69D', '#52B788', '#F4D58D'],
    palette: [
      ['#D8F3DC', '#AEDBB5', '#1F4A2B'], // 1
      ['#B7E4C7', '#86C99E', '#194528'], // 2
      ['#F5E6A8', '#DFC568', '#4E3F0A'], // 4
      ['#95D5B2', '#64B589', '#143D26'], // 8
      ['#74C69D', '#47A376', '#FFFFFF'], // 16
      ['#A3D977', '#77B546', '#1F3D0B'], // 32
      ['#F2C272', '#D49A3D', '#FFFFFF'], // 64
      ['#52B788', '#2F9164', '#FFFFFF'], // 128
      ['#40916C', '#246E4D', '#FFFFFF'], // 256
      ['#E88D72', '#C76548', '#FFFFFF'], // 512 (红豆)
      ['#2D6A4F', '#1B4A35', '#E9FCEB'], // 1024
      ['#D4A373', '#AD7A49', '#FFFFFF'], // 2048 (栗子)
      ['#1B4332', '#0D291D', '#D8F3DC'], // 4096
      ['#FFE27A', '#E0B228', '#2C3D18'], // 8192+
    ],
  },
  {
    id: '2048',
    name: '经典 2048',
    subtitle: '致敬暖金复古数字方块',
    pageBg: '#FAF8EF',
    pageText: '#776E65',
    boardBg: '#BBADA0',
    boardInner: '#CDC1B4',
    boardBorder: 'rgba(119, 110, 101, 0.25)',
    barLine: 'rgba(119, 110, 101, 0.35)',
    barTrack: 'rgba(119, 110, 101, 0.16)',
    rayFill: '#EDC22E',
    bumperIdle: 'rgba(119, 110, 101, 0.32)',
    bumperWarn: '#F2B179',
    bumperDanger: '#F65E3B',
    arrowSoft: '#EDE0C8',
    arrowMid: '#F59563',
    arrowHard: '#F65E3B',
    eyeColor: 'rgba(68, 58, 50, 0.85)',
    glossAlpha: 0.36,
    swatches: ['#EEE4DA', '#F2B179', '#F65E3B', '#EDC22E'],
    palette: [
      ['#F4EDE5', '#E3D7CA', '#776E65'], // 1
      ['#EEE4DA', '#DECBB8', '#776E65'], // 2
      ['#EDE0C8', '#DBCAAD', '#776E65'], // 4
      ['#F2B179', '#DF9557', '#FFFFFF'], // 8
      ['#F59563', '#DE7743', '#FFFFFF'], // 16
      ['#F67C5F', '#DE5D3E', '#FFFFFF'], // 32
      ['#F65E3B', '#D93E1C', '#FFFFFF'], // 64
      ['#EDCF72', '#D9B54A', '#FFFFFF'], // 128
      ['#EDCC61', '#D6B038', '#FFFFFF'], // 256
      ['#EDC850', '#D4AA28', '#FFFFFF'], // 512
      ['#EDC53F', '#D4A519', '#FFFFFF'], // 1024
      ['#EDC22E', '#D1A008', '#FFFFFF'], // 2048
      ['#4A4640', '#2E2B26', '#F9F6F2'], // 4096
      ['#262421', '#12110F', '#EDC22E'], // 8192+
    ],
  },
  {
    id: 'sunset',
    name: '落日橘子',
    subtitle: '蜜桃柑橘与晚霞紫',
    pageBg: '#22172B',
    pageText: '#FFF1E6',
    boardBg: '#2F1F3B',
    boardInner: '#251830',
    boardBorder: 'rgba(255, 190, 152, 0.18)',
    barLine: 'rgba(255, 190, 152, 0.25)',
    barTrack: 'rgba(255, 190, 152, 0.10)',
    rayFill: '#FFB074',
    bumperIdle: 'rgba(255, 190, 152, 0.22)',
    bumperWarn: '#FBBF24',
    bumperDanger: '#FB7185',
    arrowSoft: '#FCD34D',
    arrowMid: '#FB923C',
    arrowHard: '#F43F5E',
    eyeColor: 'rgba(42, 18, 34, 0.85)',
    glossAlpha: 0.44,
    swatches: ['#FFE194', '#FFB38A', '#FF758F', '#A777E3'],
    palette: [
      ['#FFE6A7', '#F2C56D', '#523400'], // 1
      ['#FFC78E', '#EB9D56', '#4F2806'], // 2
      ['#FFA577', '#E67A47', '#FFFFFF'], // 4
      ['#FF8585', '#DF565C', '#FFFFFF'], // 8
      ['#FF6B97', '#D63E6C', '#FFFFFF'], // 16
      ['#E06DD0', '#B542A6', '#FFFFFF'], // 32
      ['#B678FF', '#8748D6', '#FFFFFF'], // 64
      ['#FF9248', '#DB6114', '#FFFFFF'], // 128
      ['#FF5470', '#CC2342', '#FFFFFF'], // 256
      ['#FFD166', '#E59F1E', '#472B00'], // 512
      ['#9B5DE5', '#6E32BA', '#FFFFFF'], // 1024
      ['#F15BB5', '#C22B87', '#FFFFFF'], // 2048
      ['#FFBE0B', '#D99400', '#3B2500'], // 4096
      ['#FFF1E6', '#FFD1BA', '#4A1D3D'], // 8192+
    ],
  },
  {
    id: 'ocean',
    name: '海盐苏打',
    subtitle: '气泡冰蓝与珍珠白',
    pageBg: '#EAF7FC',
    pageText: '#14384D',
    boardBg: '#D4EEF8',
    boardInner: '#F4FBFE',
    boardBorder: 'rgba(28, 114, 158, 0.18)',
    barLine: 'rgba(28, 114, 158, 0.24)',
    barTrack: 'rgba(28, 114, 158, 0.10)',
    rayFill: '#2BB3E8',
    bumperIdle: 'rgba(28, 114, 158, 0.20)',
    bumperWarn: '#F59E0B',
    bumperDanger: '#F43F5E',
    arrowSoft: '#38BDF8',
    arrowMid: '#0EA5E9',
    arrowHard: '#F43F5E',
    eyeColor: 'rgba(14, 42, 60, 0.85)',
    glossAlpha: 0.54,
    swatches: ['#BAE6FD', '#7DD3FC', '#38BDF8', '#2DD4BF'],
    palette: [
      ['#D2F4FF', '#9FE0F7', '#13465E'], // 1
      ['#A8ECFA', '#6CD2EB', '#0E4257'], // 2
      ['#99F0E2', '#5BD6C4', '#0D4740'], // 4
      ['#7AD3FF', '#40ADE8', '#FFFFFF'], // 8
      ['#5CC2F2', '#269AD4', '#FFFFFF'], // 16
      ['#5BE0C2', '#28B899', '#FFFFFF'], // 32
      ['#6FA8FF', '#3A7BE0', '#FFFFFF'], // 64
      ['#3EA3E0', '#187BB8', '#FFFFFF'], // 128
      ['#788BFF', '#4A5FE0', '#FFFFFF'], // 256
      ['#FF99B0', '#E06582', '#FFFFFF'], // 512 (珊瑚)
      ['#2978B5', '#15548A', '#FFFFFF'], // 1024
      ['#1E4E8C', '#103161', '#E0F7FF'], // 2048
      ['#FFD97D', '#E3AE36', '#473000'], // 4096 (海星)
      ['#0F2B46', '#071729', '#7DD3FC'], // 8192+
    ],
  },
  {
    id: 'lavender',
    name: '薰衣草梦',
    subtitle: '香芋微光与星河紫',
    pageBg: '#F4F0FC',
    pageText: '#31234A',
    boardBg: '#E6DDF7',
    boardInner: '#FAF7FF',
    boardBorder: 'rgba(110, 74, 178, 0.18)',
    barLine: 'rgba(110, 74, 178, 0.24)',
    barTrack: 'rgba(110, 74, 178, 0.10)',
    rayFill: '#9B72F2',
    bumperIdle: 'rgba(110, 74, 178, 0.22)',
    bumperWarn: '#F59E0B',
    bumperDanger: '#EC4899',
    arrowSoft: '#A78BFA',
    arrowMid: '#C084FC',
    arrowHard: '#EC4899',
    eyeColor: 'rgba(42, 24, 68, 0.84)',
    glossAlpha: 0.5,
    swatches: ['#E0C3FC', '#C8A2FF', '#A78BFA', '#F9A8D4'],
    palette: [
      ['#EBD9FF', '#D0B0FA', '#3D2266'], // 1
      ['#D9C2FF', '#B894F5', '#341A5E'], // 2
      ['#F9C8E6', '#E89AC9', '#5E1E45'], // 4
      ['#C2A6FF', '#9974EB', '#FFFFFF'], // 8
      ['#AD8CFF', '#835CE0', '#FFFFFF'], // 16
      ['#E89AF0', '#C468CE', '#FFFFFF'], // 32
      ['#8FA8FF', '#5D7CE0', '#FFFFFF'], // 64
      ['#9872F2', '#6F46CF', '#FFFFFF'], // 128
      ['#F472B6', '#D4428E', '#FFFFFF'], // 256
      ['#7C5CE0', '#5435B8', '#FFFFFF'], // 512
      ['#6366F1', '#3E41C7', '#FFFFFF'], // 1024
      ['#5B21B6', '#3B1180', '#F5E8FF'], // 2048
      ['#FCD34D', '#DFA718', '#422B00'], // 4096
      ['#2E1065', '#1B0742', '#E9D5FF'], // 8192+
    ],
  },
  {
    id: 'neon',
    name: '赛博霓虹',
    subtitle: '暗夜荧光高能果冻',
    pageBg: '#0B0D14',
    pageText: '#E9F2FF',
    boardBg: '#121626',
    boardInner: '#0D101C',
    boardBorder: 'rgba(0, 245, 212, 0.24)',
    barLine: 'rgba(0, 245, 212, 0.32)',
    barTrack: 'rgba(0, 245, 212, 0.10)',
    rayFill: '#00F5D4',
    bumperIdle: 'rgba(0, 245, 212, 0.22)',
    bumperWarn: '#FEE440',
    bumperDanger: '#FF2A85',
    arrowSoft: '#00F5D4',
    arrowMid: '#FEE440',
    arrowHard: '#FF2A85',
    eyeColor: 'rgba(10, 12, 22, 0.88)',
    glossAlpha: 0.46,
    swatches: ['#00F5D4', '#00BBF9', '#FEE440', '#F15BB5'],
    palette: [
      ['#4DF8E3', '#00C4AD', '#03332C'], // 1
      ['#4DD2FF', '#0096D6', '#042A3D'], // 2
      ['#FFF066', '#D9C014', '#3D3500'], // 4
      ['#FF8A5B', '#DB5423', '#FFFFFF'], // 8
      ['#FF59B6', '#CC2483', '#FFFFFF'], // 16
      ['#B96BFF', '#8632D9', '#FFFFFF'], // 32
      ['#6BFF7B', '#28CC3B', '#09380E'], // 64
      ['#FF3D6E', '#C91243', '#FFFFFF'], // 128
      ['#5E88FF', '#2954D9', '#FFFFFF'], // 256
      ['#00F5D4', '#00A896', '#032B26'], // 512
      ['#FFBE0B', '#D49100', '#382500'], // 1024
      ['#FF007F', '#BA005C', '#FFFFFF'], // 2048
      ['#8338EC', '#5815BA', '#FFFFFF'], // 4096
      ['#FFFFFF', '#B8F2FF', '#0E1324'], // 8192+
    ],
  },
];

export function getStyleById(id) {
  return SOBO_STYLES.find((s) => s.id === id) || SOBO_STYLES[0];
}

export function getBlobColors(style, value) {
  const tier = Math.max(0, Math.round(Math.log2(Math.max(1, value))));
  const idx = Math.min(tier, style.palette.length - 1);
  const [light, dark, text] = style.palette[idx];
  return { light, dark, text };
}
