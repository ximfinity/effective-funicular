/** Single source for the legal disclaimer shown in the app, exports and docs. */

export const SHORT_DISCLAIMER =
  'Unofficial independent project. Not affiliated with, endorsed by, or produced in collaboration with Fairfax County Public Schools, the Fairfax County School Board, or Fairfax County Government.'

export const DISCLAIMER_VERSION = '2026-10-1'

export const DISCLAIMER_SECTIONS: { title: string; body: string }[] = [
  {
    title: 'Unofficial and independent',
    body:
      'FCPS Boundary Explorer is an independent personal project. It is not affiliated with, endorsed by, sponsored by, approved by, or produced in collaboration or consultation with Fairfax County Public Schools (FCPS), the Fairfax County School Board, Fairfax County Government, the City of Fairfax, the Virginia Department of Education, or any other government agency, school, school board, or public entity. No such entity has reviewed or verified this tool or its contents.',
  },
  {
    title: 'Not an official school assignment',
    body:
      'Nothing in this tool determines, predicts, or guarantees the school any student is or will be assigned to. Boundaries, scenarios and "optimized" proposals shown here are hypothetical illustrations, not official proposals or decisions. For official attendance boundaries and assignments use the FCPS Boundary Explorer and FCPS Office of Facilities Planning Services. Only the Fairfax County School Board can adopt school boundaries.',
  },
  {
    title: 'Estimates, not facts',
    body:
      'Student counts by neighborhood, projections, demographic estimates, walk distances, barrier and crossing designations, bus riders, bus routes and fleet sizes are produced by statistical and computational models built from public data. They are approximations that may be incomplete, outdated or wrong, and they may differ materially from official FCPS figures. Demographic figures are modeled neighborhood estimates, never data about any individual.',
  },
  {
    title: 'Not a safety assessment',
    body:
      'Walk zones, "barrier" roads and inferred signalized crossings are modeling assumptions. They are not evaluations of whether any route is safe for a child to walk, and must not be used to decide whether a student walks or rides a bus. Walking eligibility and hazard determinations are made by FCPS Transportation Services.',
  },
  {
    title: 'No warranty; limitation of liability',
    body:
      'This tool and its data are provided "as is" and "as available", without warranties of any kind, express or implied, including accuracy, completeness, timeliness, merchantability, fitness for a particular purpose, or non-infringement. You use it at your own risk. Do not rely on it for real-estate, enrollment, transportation, legal, financial, or safety decisions. To the fullest extent permitted by law, the author is not liable for any loss or damage arising from use of, or reliance on, this tool or its contents.',
  },
  {
    title: 'Data sources and names',
    body:
      'Inputs are publicly available data: Fairfax County GIS open data, the FCPS Adopted Capital Improvement Program FY 2027-31, the FCPS 2024-25 bell schedule, and the NCES Common Core of Data. These sources are used under their own terms and their publishers do not endorse this tool. Names of schools, agencies and places are used only to identify them; no endorsement or affiliation is implied. Basemap © OpenStreetMap contributors and OpenFreeMap.',
  },
  {
    title: 'Privacy',
    body:
      'The tool contains no student records or personal information. Scenarios you save stay in your own browser unless you share a link or file. Address searches are sent to the third-party Photon geocoder (komoot) to find the location. Nothing else is collected.',
  },
  {
    title: 'Not legal or professional advice',
    body:
      'Content here is for general informational and educational purposes, to help the public understand and discuss how school boundaries work. It is not legal, planning, or professional advice. Questions about official boundaries should go to FCPS or the Fairfax County School Board.',
  },
]
