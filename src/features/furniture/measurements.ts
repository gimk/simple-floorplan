// Reference dimensions shown by the "Measurements" cheatsheet at the bottom of the Design mode
// Inspect panel (read-only). Values are the usual European (metric) planning sizes, in cm.
// The order of the groups and of the rows is the reading order of the card.

export type MeasurementItem = {
  /** What is measured. */
  label: string
  /** The usual size, with its unit inside the string. */
  value: string
}

export type MeasurementGroup = {
  /** Subheading of the group. */
  title: string
  /** Rows of the group. */
  items: MeasurementItem[]
}

/** Seven groups of everyday planning sizes. */
export const MEASUREMENT_GROUPS: MeasurementGroup[] = [
  {
    title: 'Circulation',
    items: [
      { label: 'Corridor / walkway', value: '90 cm min, 120 cm comfortable' },
      { label: 'Wheelchair turning circle', value: 'Ø 150 cm' },
      { label: 'Interior door leaf', value: '73 / 83 / 93 cm' },
      { label: 'Free door passage', value: '80 cm min' },
      { label: 'In front of a wardrobe', value: '90 cm (hinged), 70 cm (sliding)' },
    ],
  },
  {
    title: 'Bedroom',
    items: [
      { label: 'Beside the bed', value: '60–70 cm' },
      { label: 'At the foot of the bed', value: '90 cm to walk past' },
      { label: 'Bed sizes', value: '90, 140, 160, 180 × 200 cm' },
    ],
  },
  {
    title: 'Living',
    items: [
      { label: 'Sofa to coffee table', value: '40–45 cm' },
      { label: 'Sofa to TV', value: '200–300 cm' },
      { label: 'Seat height', value: '45 cm' },
    ],
  },
  {
    title: 'Dining',
    items: [
      { label: 'Width per seat', value: '60 cm, 70 cm comfortable' },
      { label: 'Table edge to wall (seated)', value: '75 cm' },
      { label: 'Table edge to wall (walk behind)', value: '100 cm' },
      { label: 'Table height', value: '75 cm' },
    ],
  },
  {
    title: 'Kitchen',
    items: [
      { label: 'Counter depth / height', value: '60–65 cm / 90 cm' },
      { label: 'Between two counter runs', value: '120 cm (100 cm min)' },
      { label: 'Work triangle (sum of sides)', value: '360–660 cm' },
      { label: 'Wall cabinets', value: '50–60 cm above counter, 35 cm deep' },
    ],
  },
  {
    title: 'Bathroom',
    items: [
      { label: 'Free space in front of toilet', value: '60 cm' },
      { label: 'Toilet width zone', value: '80 cm min' },
      { label: 'In front of washbasin', value: '70 cm' },
      { label: 'In front of bath / shower', value: '70 cm' },
      { label: 'Washbasin height', value: '85 cm' },
    ],
  },
  {
    title: 'Heights',
    items: [
      { label: 'Ceiling', value: '250 cm typical' },
      { label: 'Light switch', value: '110 cm' },
      { label: 'Socket', value: '25–30 cm' },
      { label: 'Desk', value: '72–75 cm' },
      { label: 'Window sill', value: '90 cm' },
    ],
  },
]
