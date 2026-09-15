window.NexusData = {
  credentials: { id: 'officer@nexus.ai', password: 'Officer@2026!' },
  entities: {
    arjun: { name: 'Arjun Mehra', initials: 'AM', role: 'Primary subject', risk: '92', connections: ['Riya Shah', 'Unknown Device K-19', 'Harbor Warehouse'], phones: ['+91 98••• 1827', '+91 70••• 5904'], note: 'Centrality analysis places this subject at the intersection of communications, financial movement and location activity.', criminalId: 'CR-MH-2026-0001', firNumber: 'FIR-MH-2026-0147', cnrNumber: 'CNR-MH-0192847' },
    riya: { name: 'Riya Shah', initials: 'RS', role: 'Associate', risk: '74', connections: ['Arjun Mehra', 'Account ••8821'], phones: ['+91 99••• 4518'], note: 'Repeated contact with the primary subject within two hours of anomalous transfer events.', criminalId: 'CR-MH-2026-0002', firNumber: 'FIR-MH-2026-0147', cnrNumber: 'CNR-MH-0192848' },
    device: { name: 'Unknown Device K-19', initials: 'K19', role: 'Linked communication device', risk: '81', connections: ['Arjun Mehra', 'Account ••8821'], phones: ['IMSI 404-11-••••••'], note: 'New device appeared within the known communication cluster shortly before a flagged event.', criminalId: '', firNumber: 'FIR-MH-2026-0147', cnrNumber: '' },
    harbor: { name: 'Harbor Warehouse', initials: 'HW', role: 'Shared location', risk: '68', connections: ['Arjun Mehra', 'Riya Shah'], phones: [], note: 'Co-location signals show three linked entities present within the same 90-minute period.', criminalId: '', firNumber: 'FIR-MH-2026-0147', cnrNumber: '' },
    account: { name: 'Account ••8821', initials: '₹', role: 'Financial channel', risk: '87', connections: ['Riya Shah', 'Unknown Device K-19'], phones: [], note: 'Transfers form a rapid circular pattern across three accounts; human review recommended.', criminalId: '', firNumber: 'FIR-MH-2026-0147', cnrNumber: '' },
    vehicle: { name: 'Vehicle DL-8C-••427', initials: 'V', role: 'Linked vehicle', risk: '56', connections: ['Harbor Warehouse'], phones: [], note: 'Vehicle has repeated proximity signals near a location of interest.', criminalId: '', firNumber: '', cnrNumber: '' }
  }
,
  suspectActivities: [
    {t:'14 min ago', icon:'H', text:'New CDR link: Arjun Mehra <-> Device K-19 (42 calls, night window 02:00-04:00)', entity:'arjun'},
    {t:'42 min ago', icon:'R', text:'Rs 4.8L circular transfer via Account 8821 flagged for review', entity:'account'},
    {t:'1 hr ago', icon:'P', text:'Suspect Arjun Mehra made 7 calls to unknown device', entity:'arjun'},
    {t:'2 hr ago', icon:'L', text:'Shared presence: Arjun + Riya + Vehicle DL-8C at Harbor Warehouse (90-min window)', entity:'harbor'},
    {t:'5 hr ago', icon:'M', text:'Rs 2.3L transfer to linked account - pattern matches previous modus', entity:'account'},
    {t:'6 hr ago', icon:'V', text:'Vehicle DL-8C spotted near harbor toll, no FASTag', entity:'vehicle'},
    {t:'8 hr ago', icon:'F', text:'FIR #452/24 updated with new witness testimony', entity:'arjun'}
  ],
  caseReport: {caseNo:'NTF-042', fir:'FIR-MH-2026-0147', cnr:'CNR-MH-0192847', title:'Operation Nightfall', status:'Active', priority:'High', lead:'Officer K. Rao'}
};
