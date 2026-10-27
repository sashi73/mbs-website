/* Mr. Fixit knowledge base — everything here is public website information.
   Edit freely: wording, services, keywords. No secrets in this file. */
window.MBS_KB = {
  business: 'Modern Building Solutions',
  short: 'MBS',
  phone: '0420 494 990',
  tel: 'tel:0420494990',
  email: 'mbs.pty.ltd@gmail.com',
  licence: '267071C',
  // Set these when confirmed, e.g. 'Sydney and surrounding suburbs' / 'Monday to Saturday, 7am to 5pm'.
  // While empty, Mr. Fixit avoids making claims about them.
  area: 'Sydney and surrounding suburbs',
  hours: 'anytime (24 hours)',
  since: '2012',
  accreditations: ['ISO 9001', 'Cm3', 'NSW Government', 'NSW Government Education', 'AIB (The Australian Institute of Building)', 'Ardex', 'Fatra'],

  services: [
    // ---- From the capability statement ----
    { group: 'Construction & project management', name: 'Contract project management', desc: 'We can run the whole project for you: trades, programme, quality and handover.',
      keys: ['project manag', 'manage the project', 'manage my project', 'contract manag', 'head contractor', 'commercial project'] },
    { group: 'Construction & project management', name: 'Heritage building renovations', desc: 'Careful renovation and painting of heritage buildings, like our ceiling work at Central Station.',
      keys: ['heritage', 'period home', 'federation', 'sandstone', 'victorian', 'old building'] },
    { group: 'Construction & project management', name: 'Carpentry', desc: 'Framing, subfloors, decks and finishing carpentry.',
      keys: ['carpent', 'framing', 'skirting', 'architrave', 'subfloor'] },
    { group: 'Construction & project management', name: 'Aluminium cladding installation', desc: 'New cladding for a clean, durable exterior.',
      keys: ['cladding', 'aluminium', 'facade', 'façade'] },
    { group: 'Remedial & waterproofing', name: 'Balcony reconstruction', desc: 'Balconies rebuilt with new waterproofing, flashings, drainage and tiles.',
      keys: ['balcony rebuild', 'balcony reconstruct', 'rebuild the balcony', 'leaking balcony', 'balcony leak'] },
    { group: 'Remedial & waterproofing', name: 'Render repair and rendering', desc: 'Failed render removed and walls re-rendered.',
      keys: ['rendering', 'render repair', 'drummy', 'bagging', 'cracked render'] },
    { group: 'Remedial & waterproofing', name: 'Fire protection upgrades', desc: 'Fire-resistant shutters and fire-resistant mesh installed.',
      keys: ['fire shutter', 'fire rated', 'fire resistant', 'fire protection', 'fire door'] },
    { group: 'Painting & finishes', name: 'Commercial and strata painting', desc: 'Painting for hotels, strata buildings, aged care and commercial sites.',
      keys: ['strata', 'body corporate', 'apartment block', 'commercial paint', 'hotel', 'aged care', 'whole building'] },
    { group: 'Painting & finishes', name: 'Peel Away paint removal', desc: 'Old paint layers stripped back safely before repainting.',
      keys: ['peel away', 'paint removal', 'strip paint', 'stripping paint', 'remove old paint'] },
    { group: 'Tiling, floors & outdoor', name: 'Floor levelling and floor panels', desc: 'Subfloors levelled and new floor panels laid.',
      keys: ['floor level', 'uneven floor', 'sloping floor', 'bouncy floor', 'floor panel', 'floating floor', 'laminate'] },
    { group: 'Tiling, floors & outdoor', name: 'Pool tiling', desc: 'Mosaic and edge tiling for pools.',
      keys: ['pool tile', 'pool tiling', 'mosaic'] },
    // ---- Construction & repairs ----
    { group: 'Construction & repairs', name: 'Construction', desc: 'New building work and extensions, managed from start to handover.',
      keys: ['construction', 'build', 'building', 'extension', 'new build', 'granny flat', 'addition'] },
    { group: 'Construction & repairs', name: 'Home upgrades and renovations', desc: 'Improvements that lift the comfort, function and value of your home.',
      keys: ['renovat', 'reno', 'upgrade', 'remodel', 'makeover', 'update my', 'kitchen', 'laundry'] },
    { group: 'Construction & repairs', name: 'Wall removal and relocation', desc: 'Open up or reconfigure your floor plan to suit how you live.',
      keys: ['wall remov', 'remove a wall', 'remove wall', 'knock down', 'knock out', 'open plan', 'move a wall', 'relocat', 'wall'] },
    { group: 'Construction & repairs', name: 'Window and door installation', desc: 'Supply and fit of new windows and doors, properly sealed.',
      keys: ['window', 'door', 'sliding', 'french door', 'bifold', 'bi-fold'] },
    { group: 'Construction & repairs', name: 'Concrete cancer and crack repair', desc: 'Treat spalling concrete and cracks before they become costly.',
      keys: ['concrete cancer', 'concrete', 'crack', 'spalling', 'rust stain', 'render'] },
    { group: 'Construction & repairs', name: 'Gyprock installation and repair', desc: 'New plasterboard, patching and repairs with a clean finish.',
      keys: ['gyprock', 'plasterboard', 'plaster', 'drywall', 'hole in the wall', 'ceiling', 'cornice'] },
    // ---- Waterproofing & roofing ----
    { group: 'Waterproofing & roofing', name: 'Waterproofing', desc: 'Bathrooms, balconies and wet areas sealed to last.',
      keys: ['waterproof', 'membrane', 'balcony', 'shower', 'bathroom', 'wet area'] },
    { group: 'Waterproofing & roofing', name: 'Roof leak repair', desc: 'We find and fix leaks to protect your ceilings and structure.',
      keys: ['roof', 'tile', 'ridge', 'flashing'] },
    { group: 'Waterproofing & roofing', name: 'Water leak testing', desc: 'Flood and hose testing to find exactly where water is getting in.',
      keys: ['water test', 'leak test', 'flood test', 'find the leak', 'where the water'] },
    { group: 'Waterproofing & roofing', name: 'Gutter and downpipe installation', desc: 'New gutters and downpipes that carry water away cleanly.',
      keys: ['gutter', 'downpipe', 'down pipe', 'overflow', 'storm water', 'stormwater'] },
    { group: 'Waterproofing & roofing', name: 'Tiling', desc: 'Floor and wall tiling for bathrooms, kitchens, balconies and outdoors.',
      keys: ['tiling', 'tiles', 'tiler', 'retil', 'retile', 'retiling', 're-tile', 'floor tile', 'wall tile', 'regrout', 'grout', 'splashback'] },
    // ---- Outdoor & finishes ----
    { group: 'Outdoor & finishes', name: 'Decking', desc: 'Hardwood and composite decks and stairs built to last.',
      keys: ['deck', 'decking', 'composite', 'merbau', 'stairs', 'steps', 'rotten'] },
    { group: 'Outdoor & finishes', name: 'Pergola installation', desc: 'Covered outdoor areas for shade and year-round use.',
      keys: ['pergola', 'patio', 'carport', 'shade', 'alfresco', 'cover'] },
    { group: 'Outdoor & finishes', name: 'Fencing, all types', desc: 'Timber, front, boundary, privacy and pool-side fencing.',
      keys: ['fence', 'fencing', 'gate', 'boundary', 'privacy screen', 'screen', 'paling'] },
    { group: 'Outdoor & finishes', name: 'Deck and fence packages', desc: 'A new deck and matching fence in one job, for a finished outdoor space.',
      keys: ['deck and fence', 'deck & fence', 'package', 'backyard'] },
    { group: 'Outdoor & finishes', name: 'Painting and special effect finishes', desc: 'Interior and exterior painting, plus textured, metallic and feature finishes.',
      keys: ['paint', 'painting', 'painter', 'repaint', 'feature wall', 'texture', 'metallic'] },
    { group: 'Outdoor & finishes', name: 'Wallpaper installation, all types', desc: 'Feature walls and full rooms, with precise pattern matching.',
      keys: ['wallpaper', 'wall paper'] },
    { group: 'Outdoor & finishes', name: 'Acoustic panel installation', desc: 'Timber slat and acoustic panels for better sound and style.',
      keys: ['acoustic', 'slat', 'noise', 'sound proof', 'soundproof', 'echo'] }
  ],

  process: [
    'You call or send your details.',
    'We visit and give you a clear, free quote.',
    'We do the work, with one person managing your job.',
    'We walk through every detail with you before we finish.'
  ]
};
