// Reference dimensions shown by the "Measurements" cheatsheet at the bottom of the Design mode
// Inspect panel (read-only). Values are the usual European (metric) planning sizes, in cm.
// One group is shown at a time: a chip row selects the group, the rows of that group follow.
// The order of the groups and of the rows is the reading order of the card.

export type MeasurementItem = {
  /** What is measured. */
  label: string
  /** The usual size, with its unit inside the string. Kept short: it never wraps. */
  value: string
  /** Optional precision or limit, shown as a second, quieter line under the value. */
  note?: string
}

export type MeasurementGroup = {
  /** Full name of the group. */
  title: string
  /** Short name of the group, used as the chip label (unique). */
  short: string
  /** Rows of the group. */
  items: MeasurementItem[]
}

/** Seven groups of everyday planning sizes. */
export const MEASUREMENT_GROUPS: MeasurementGroup[] = [
  {
    title: 'Circulation',
    short: 'Circulation',
    items: [
      { label: 'Walkway', value: '90 cm', note: '120 cm comfortable' },
      { label: 'Wheelchair turning', value: 'Ø 150 cm' },
      { label: 'Door leaf', value: '73 / 83 / 93 cm' },
      { label: 'Door passage', value: '80 cm', note: 'minimum' },
      { label: 'In front of a wardrobe', value: '90 cm', note: '70 cm with sliding doors' },
    ],
  },
  {
    title: 'Bedroom',
    short: 'Bedroom',
    items: [
      { label: 'Beside the bed', value: '60–70 cm' },
      { label: 'Foot of the bed', value: '90 cm', note: 'to walk past' },
      { label: 'Bed width', value: '90–180 cm', note: '90, 140, 160 or 180 × 200 cm' },
    ],
  },
  {
    title: 'Living',
    short: 'Living',
    items: [
      { label: 'Sofa to coffee table', value: '40–45 cm' },
      { label: 'Sofa to TV', value: '200–300 cm' },
      { label: 'Seat height', value: '45 cm' },
    ],
  },
  {
    title: 'Dining',
    short: 'Dining',
    items: [
      { label: 'Width per seat', value: '60 cm', note: '70 cm comfortable' },
      { label: 'Table to wall, seated', value: '75 cm' },
      { label: 'Table to wall, walk behind', value: '100 cm' },
      { label: 'Table height', value: '75 cm' },
    ],
  },
  {
    title: 'Kitchen',
    short: 'Kitchen',
    items: [
      { label: 'Counter depth', value: '60–65 cm' },
      { label: 'Counter height', value: '90 cm' },
      { label: 'Between counter runs', value: '120 cm', note: '100 cm minimum' },
      { label: 'Work triangle', value: '360–660 cm', note: 'sum of the 3 sides' },
      { label: 'Wall cabinets', value: '50–60 cm', note: 'above the counter, 35 cm deep' },
    ],
  },
  {
    title: 'Bathroom',
    short: 'Bath',
    items: [
      { label: 'In front of the toilet', value: '60 cm' },
      { label: 'Toilet zone width', value: '80 cm', note: 'minimum' },
      { label: 'In front of the washbasin', value: '70 cm' },
      { label: 'In front of bath / shower', value: '70 cm' },
      { label: 'Washbasin height', value: '85 cm' },
    ],
  },
  {
    title: 'Heights',
    short: 'Heights',
    items: [
      { label: 'Ceiling', value: '250 cm', note: 'typical' },
      { label: 'Light switch', value: '110 cm' },
      { label: 'Socket', value: '25–30 cm' },
      { label: 'Desk', value: '72–75 cm' },
      { label: 'Window sill', value: '90 cm' },
    ],
  },
]
