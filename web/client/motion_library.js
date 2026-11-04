/* motionLibrary.js: motions drafted by chat in bulk (note 59) and kept by Design after checkMotion and an eye check
 * on an adult, a child and (for head-and-tail motions) the cat, 2026-11-02. Data only; motionKit.js merges it into MOTIONS.
 * Rework list (not here): sitDown: Front-view legs splay apart when the knees bend; needs a seat piece and a seated pose drawn for it.; standUp: The reverse of sitDown, same problem.; kneel: The shins detach from the body at the knee cut; needs a kneeling pose drawn for it.; thumbsUp: There is no thumb joint, so it reads as a small wave; needs a hand drawn with a thumb. *
 * 2026-11-03: round two and three drafts curated (41 of 44 kept); Design added four care motions; rework adds: you: Taps the chest, so it reads as "I"; pointing at the viewer needs a drawn foreshortened pose.; thumbsDown: No thumb joint, the same as thumbsUp; needs a hand drawn with a thumb. */
export const MOTION_LIBRARY = {
 "allDone": {
  "id": "allDone",
  "name": "All done (hands sweep open)",
  "words": [
   "all done",
   "finished",
   "done",
   "no more",
   "that's all",
   "stop eating",
   "I'm finished"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.5,
  "face": "neutral",
  "tracks": {
   "shoulderL": {
    "rot": [
     [
      0,
      -6
     ],
     [
      0.3,
      52
     ],
     [
      0.65,
      52
     ],
     [
      1,
      -6
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      6
     ],
     [
      0.3,
      -52
     ],
     [
      0.65,
      -52
     ],
     [
      1,
      6
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "appear": {
  "id": "appear",
  "name": "Appear (fade and grow in)",
  "words": [
   "appear",
   "show up",
   "pop up",
   "new",
   "there"
  ],
  "tags": [
   "move",
   "piece",
   "aac"
  ],
  "target": "piece",
  "duration": 1600,
  "loop": false,
  "still": 1,
  "tracks": {
   "root": {
    "scale": [
     [
      0,
      0.6
     ],
     [
      0.5,
      0.92
     ],
     [
      1,
      1
     ]
    ],
    "opacity": [
     [
      0,
      0
     ],
     [
      0.5,
      1
     ],
     [
      1,
      1
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "beckon": {
  "id": "beckon",
  "name": "Beckon (come here)",
  "words": [
   "come here",
   "come",
   "here",
   "come on",
   "follow me",
   "this way",
   "join me"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 1600,
  "loop": true,
  "still": 0.25,
  "face": "happy",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      -95
     ],
     [
      1,
      -95
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      -70
     ],
     [
      0.25,
      -105
     ],
     [
      0.5,
      -70
     ],
     [
      0.75,
      -105
     ],
     [
      1,
      -70
     ]
    ]
   },
   "wristR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      -18
     ],
     [
      0.5,
      0
     ],
     [
      0.8,
      -18
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "faceY": [
     [
      0,
      0
     ],
     [
      0.25,
      3
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      3
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "bounce": {
  "id": "bounce",
  "name": "Bounce (gentle)",
  "words": [
   "bounce",
   "bouncy",
   "happy",
   "playful",
   "fun",
   "spring",
   "boing"
  ],
  "tags": [
   "move",
   "piece",
   "loop"
  ],
  "target": "piece",
  "duration": 1600,
  "loop": true,
  "still": 0,
  "tracks": {
   "root": {
    "y": [
     [
      0,
      0
     ],
     [
      0.25,
      -16
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -8
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "bow": {
  "id": "bow",
  "name": "Bow",
  "words": [
   "bow",
   "thank you",
   "respect",
   "greet",
   "welcome",
   "excuse me"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture",
   "body"
  ],
  "target": "body",
  "duration": 1800,
  "loop": false,
  "still": 0.48,
  "face": "happy",
  "tracks": {
   "waist": {
    "y": [
     [
      0,
      0
     ],
     [
      0.35,
      12
     ],
     [
      0.6,
      12
     ],
     [
      0.9,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "y": [
     [
      0,
      0
     ],
     [
      0.35,
      8
     ],
     [
      0.6,
      8
     ],
     [
      0.9,
      0
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.35,
      9
     ],
     [
      0.6,
      9
     ],
     [
      0.9,
      0
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "bye": {
  "id": "bye",
  "name": "Bye (wave, then turn away)",
  "words": [
   "bye",
   "goodbye",
   "see you",
   "see you later",
   "I'm going",
   "leaving",
   "I have to go",
   "all finished here"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 2000,
  "loop": false,
  "still": 0.14,
  "face": "happy",
  "pose": "wave",
  "tracks": {
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.14,
      -24
     ],
     [
      0.28,
      0
     ],
     [
      0.42,
      -24
     ],
     [
      0.56,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.6,
      0
     ],
     [
      0.92,
      158
     ],
     [
      1,
      158
     ]
    ]
   },
   "shoulderL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.6,
      0
     ],
     [
      0.92,
      -7
     ],
     [
      1,
      -7
     ]
    ]
   },
   "waist": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.6,
      0
     ],
     [
      0.88,
      4
     ],
     [
      1,
      4
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.6,
      0
     ],
     [
      0.88,
      4
     ],
     [
      1,
      4
     ]
    ],
    "faceX": [
     [
      0,
      0
     ],
     [
      0.6,
      0
     ],
     [
      0.88,
      9
     ],
     [
      1,
      9
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "cheer": {
  "id": "cheer",
  "name": "Cheer (hooray)",
  "words": [
   "cheer",
   "hooray",
   "yay",
   "celebrate",
   "happy",
   "win",
   "good job"
  ],
  "tags": [
   "aac",
   "emote",
   "feeling"
  ],
  "target": "body",
  "duration": 1600,
  "loop": true,
  "still": 0.25,
  "face": "happy",
  "tracks": {
   "root": {
    "y": [
     [
      0,
      0
     ],
     [
      0.25,
      -8
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -8
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderL": {
    "rot": [
     [
      0,
      148
     ],
     [
      0.25,
      156
     ],
     [
      0.5,
      148
     ],
     [
      0.75,
      156
     ],
     [
      1,
      148
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      -148
     ],
     [
      0.25,
      -156
     ],
     [
      0.5,
      -148
     ],
     [
      0.75,
      -156
     ],
     [
      1,
      -148
     ]
    ]
   },
   "neck": {
    "y": [
     [
      0,
      2
     ],
     [
      0.25,
      0
     ],
     [
      0.5,
      2
     ],
     [
      0.75,
      0
     ],
     [
      1,
      2
     ]
    ],
    "faceY": [
     [
      0,
      3
     ],
     [
      0.25,
      -2
     ],
     [
      0.5,
      3
     ],
     [
      0.75,
      -2
     ],
     [
      1,
      3
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "clap": {
  "id": "clap",
  "name": "Clap",
  "words": [
   "clap",
   "applause",
   "well done",
   "good job",
   "yay",
   "bravo",
   "celebrate",
   "happy"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture",
   "feeling"
  ],
  "target": "body",
  "duration": 1600,
  "loop": true,
  "still": 0.2,
  "face": "happy",
  "tracks": {
   "shoulderL": {
    "rot": [
     [
      0,
      -8
     ],
     [
      0.2,
      -24
     ],
     [
      0.4,
      -8
     ],
     [
      0.6,
      -24
     ],
     [
      0.8,
      -8
     ],
     [
      1,
      -8
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      8
     ],
     [
      0.2,
      24
     ],
     [
      0.4,
      8
     ],
     [
      0.6,
      24
     ],
     [
      0.8,
      8
     ],
     [
      1,
      8
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      -55
     ],
     [
      0.2,
      -78
     ],
     [
      0.4,
      -55
     ],
     [
      0.6,
      -78
     ],
     [
      0.8,
      -55
     ],
     [
      1,
      -55
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      55
     ],
     [
      0.2,
      78
     ],
     [
      0.4,
      55
     ],
     [
      0.6,
      78
     ],
     [
      0.8,
      55
     ],
     [
      1,
      55
     ]
    ]
   },
   "neck": {
    "y": [
     [
      0,
      0
     ],
     [
      0.2,
      2
     ],
     [
      0.4,
      0
     ],
     [
      0.6,
      2
     ],
     [
      0.8,
      0
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.2,
      3
     ],
     [
      0.4,
      0
     ],
     [
      0.6,
      3
     ],
     [
      0.8,
      0
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "drink": {
  "id": "drink",
  "name": "Drink",
  "words": [
   "drink",
   "thirsty",
   "water",
   "juice",
   "milk",
   "cup"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture",
   "action"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.5,
  "face": "neutral",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      20
     ],
     [
      0.7,
      20
     ],
     [
      1,
      0
     ]
    ],
    "y": [
     [
      0,
      0
     ],
     [
      0.25,
      -6
     ],
     [
      0.7,
      -6
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      150
     ],
     [
      0.7,
      150
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "y": [
     [
      0,
      0
     ],
     [
      0.4,
      -2
     ],
     [
      0.6,
      -2
     ],
     [
      0.78,
      0
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.4,
      -6
     ],
     [
      0.6,
      -6
     ],
     [
      0.78,
      0
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02",
  "props": {
   "wristR": "cup"
  }
 },
 "listenTilt": {
  "id": "listenTilt",
  "name": "Head perk (listening), stand-in for ear flick",
  "words": [
   "listen",
   "hear",
   "what was that",
   "sound",
   "quiet"
  ],
  "tags": [
   "emote",
   "gesture",
   "cat",
   "stand-in"
  ],
  "target": "body",
  "duration": 1400,
  "loop": false,
  "still": 0.35,
  "face": "neutral",
  "tracks": {
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.35,
      5
     ],
     [
      0.7,
      5
     ],
     [
      1,
      0
     ]
    ],
    "faceX": [
     [
      0,
      0
     ],
     [
      0.35,
      6
     ],
     [
      0.7,
      6
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.35,
      -3
     ],
     [
      0.7,
      -3
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "eat": {
  "id": "eat",
  "name": "Eat (hand to mouth)",
  "words": [
   "eat",
   "food",
   "hungry",
   "bite",
   "snack",
   "meal",
   "lunch",
   "dinner"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.28,
  "face": "happy",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.28,
      -30
     ],
     [
      0.78,
      -30
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.28,
      150
     ],
     [
      0.5,
      134
     ],
     [
      0.7,
      150
     ],
     [
      0.78,
      150
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "y": [
     [
      0,
      0
     ],
     [
      0.28,
      0
     ],
     [
      0.5,
      1.5
     ],
     [
      0.7,
      0
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.28,
      0
     ],
     [
      0.5,
      3
     ],
     [
      0.7,
      0
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "enterRight": {
  "id": "enterRight",
  "name": "Enter from the right",
  "words": [
   "enter",
   "arrive",
   "come in",
   "here"
  ],
  "tags": [
   "move",
   "piece"
  ],
  "target": "piece",
  "duration": 2400,
  "loop": false,
  "still": 1,
  "tracks": {
   "root": {
    "x": [
     [
      0,
      420
     ],
     [
      1,
      0
     ]
    ],
    "opacity": [
     [
      0,
      0
     ],
     [
      0.15,
      1
     ],
     [
      1,
      1
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "exitLeft": {
  "id": "exitLeft",
  "name": "Exit to the left",
  "words": [
   "exit",
   "leave",
   "go out",
   "go away",
   "bye",
   "goodbye",
   "left"
  ],
  "tags": [
   "move",
   "piece"
  ],
  "target": "piece",
  "duration": 2400,
  "loop": false,
  "still": 0,
  "tracks": {
   "root": {
    "x": [
     [
      0,
      0
     ],
     [
      1,
      -420
     ]
    ],
    "opacity": [
     [
      0,
      1
     ],
     [
      0.85,
      1
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "exitRight": {
  "id": "exitRight",
  "name": "Exit to the right",
  "words": [
   "exit",
   "leave",
   "go out",
   "go away",
   "bye",
   "goodbye"
  ],
  "tags": [
   "move",
   "piece"
  ],
  "target": "piece",
  "duration": 2400,
  "loop": false,
  "still": 0,
  "tracks": {
   "root": {
    "x": [
     [
      0,
      0
     ],
     [
      1,
      420
     ]
    ],
    "opacity": [
     [
      0,
      1
     ],
     [
      0.85,
      1
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "float": {
  "id": "float",
  "name": "Float (gentle bob)",
  "words": [
   "float",
   "hover",
   "drift",
   "fly",
   "ghost",
   "cloud",
   "light"
  ],
  "tags": [
   "move",
   "piece",
   "loop",
   "calm"
  ],
  "target": "piece",
  "duration": 2000,
  "loop": true,
  "still": 0,
  "tracks": {
   "root": {
    "y": [
     [
      0,
      0
     ],
     [
      0.125,
      -1.5
     ],
     [
      0.25,
      -5
     ],
     [
      0.375,
      -8.5
     ],
     [
      0.5,
      -10
     ],
     [
      0.625,
      -8.5
     ],
     [
      0.75,
      -5
     ],
     [
      0.875,
      -1.5
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "help": {
  "id": "help",
  "name": "Help (hand raised)",
  "words": [
   "help",
   "help me",
   "I need help",
   "assist",
   "question",
   "me"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.5,
  "face": "neutral",
  "pose": "wave",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.5,
      -7
     ],
     [
      1,
      0
     ]
    ]
   },
   "wristR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.5,
      -6
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "faceY": [
     [
      0,
      0
     ],
     [
      0.5,
      -3
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "hop": {
  "id": "hop",
  "name": "Hop",
  "words": [
   "hop",
   "jump",
   "skip",
   "play",
   "excited"
  ],
  "tags": [
   "move",
   "piece",
   "emote"
  ],
  "target": "piece",
  "duration": 1000,
  "loop": true,
  "still": 0.4,
  "tracks": {
   "root": {
    "y": [
     [
      0,
      0
     ],
     [
      0.15,
      -14
     ],
     [
      0.3,
      -24
     ],
     [
      0.4,
      -26
     ],
     [
      0.5,
      -24
     ],
     [
      0.65,
      -14
     ],
     [
      0.8,
      0
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "jump": {
  "id": "jump",
  "name": "Jump",
  "words": [
   "jump",
   "hop up",
   "up",
   "bounce",
   "excited",
   "play"
  ],
  "tags": [
   "aac",
   "gesture",
   "emote",
   "knees"
  ],
  "target": "body",
  "duration": 1000,
  "loop": false,
  "still": 0.5,
  "face": "happy",
  "tracks": {
   "root": {
    "y": [
     [
      0,
      0
     ],
     [
      0.2,
      0
     ],
     [
      0.5,
      -30
     ],
     [
      0.74,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "waist": {
    "y": [
     [
      0,
      0
     ],
     [
      0.2,
      6
     ],
     [
      0.5,
      0
     ],
     [
      0.76,
      4
     ],
     [
      1,
      0
     ]
    ]
   },
   "kneeL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      16
     ],
     [
      0.5,
      8
     ],
     [
      0.76,
      12
     ],
     [
      1,
      0
     ]
    ]
   },
   "kneeR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      16
     ],
     [
      0.5,
      8
     ],
     [
      0.76,
      12
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      -10
     ],
     [
      0.5,
      70
     ],
     [
      0.76,
      20
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      10
     ],
     [
      0.5,
      -70
     ],
     [
      0.76,
      -20
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "faceY": [
     [
      0,
      0
     ],
     [
      0.2,
      2
     ],
     [
      0.5,
      -3
     ],
     [
      0.76,
      2
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "laugh": {
  "id": "laugh",
  "name": "Laugh",
  "words": [
   "laugh",
   "funny",
   "haha",
   "joke",
   "happy",
   "that's funny"
  ],
  "tags": [
   "aac",
   "emote",
   "feeling",
   "face"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.167,
  "face": "happy",
  "tracks": {
   "root": {
    "y": [
     [
      0,
      0
     ],
     [
      0.167,
      -3
     ],
     [
      0.333,
      0
     ],
     [
      0.5,
      -3
     ],
     [
      0.667,
      0
     ],
     [
      0.833,
      -3
     ],
     [
      1,
      0
     ]
    ]
   },
   "waist": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.167,
      -2
     ],
     [
      0.333,
      0
     ],
     [
      0.5,
      -2
     ],
     [
      0.667,
      0
     ],
     [
      0.833,
      -2
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.167,
      -2
     ],
     [
      0.333,
      0
     ],
     [
      0.5,
      -2
     ],
     [
      0.667,
      0
     ],
     [
      0.833,
      -2
     ],
     [
      1,
      0
     ]
    ],
    "y": [
     [
      0,
      0
     ],
     [
      0.167,
      -2
     ],
     [
      0.333,
      0
     ],
     [
      0.5,
      -2
     ],
     [
      0.667,
      0
     ],
     [
      0.833,
      -2
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.167,
      -4
     ],
     [
      0.333,
      0
     ],
     [
      0.5,
      -4
     ],
     [
      0.667,
      0
     ],
     [
      0.833,
      -4
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.167,
      3
     ],
     [
      0.333,
      0
     ],
     [
      0.5,
      3
     ],
     [
      0.667,
      0
     ],
     [
      0.833,
      3
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.167,
      -3
     ],
     [
      0.333,
      0
     ],
     [
      0.5,
      -3
     ],
     [
      0.667,
      0
     ],
     [
      0.833,
      -3
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "listen": {
  "id": "listen",
  "name": "Listen (lean in)",
  "words": [
   "listen",
   "hear",
   "i am listening",
   "tell me",
   "go on",
   "pay attention",
   "quiet please"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.5,
  "face": "neutral",
  "tracks": {
   "waist": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      5
     ],
     [
      0.5,
      5.5
     ],
     [
      0.75,
      5
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      4
     ],
     [
      0.5,
      4.5
     ],
     [
      0.75,
      4
     ],
     [
      1,
      0
     ]
    ],
    "y": [
     [
      0,
      0
     ],
     [
      0.3,
      3
     ],
     [
      0.5,
      3
     ],
     [
      0.75,
      3
     ],
     [
      1,
      0
     ]
    ],
    "faceX": [
     [
      0,
      0
     ],
     [
      0.3,
      4
     ],
     [
      0.5,
      4
     ],
     [
      0.75,
      4
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.3,
      3
     ],
     [
      0.5,
      3
     ],
     [
      0.75,
      3
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "lookAround": {
  "id": "lookAround",
  "name": "Look around (left, then right)",
  "words": [
   "look",
   "look around",
   "where",
   "search",
   "find",
   "see",
   "watch out",
   "what is that"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.28,
  "face": "neutral",
  "tracks": {
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      -3
     ],
     [
      0.35,
      -3
     ],
     [
      0.5,
      0
     ],
     [
      0.7,
      3
     ],
     [
      0.85,
      3
     ],
     [
      1,
      0
     ]
    ],
    "faceX": [
     [
      0,
      0
     ],
     [
      0.2,
      -9
     ],
     [
      0.35,
      -9
     ],
     [
      0.5,
      0
     ],
     [
      0.7,
      9
     ],
     [
      0.85,
      9
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "more": {
  "id": "more",
  "name": "More (hands together)",
  "words": [
   "more",
   "again",
   "some more",
   "another",
   "keep going"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.25,
  "face": "happy",
  "tracks": {
   "shoulderL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -28
     ],
     [
      0.42,
      -20
     ],
     [
      0.6,
      -28
     ],
     [
      0.8,
      -28
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      28
     ],
     [
      0.42,
      20
     ],
     [
      0.6,
      28
     ],
     [
      0.8,
      28
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -55
     ],
     [
      0.42,
      -42
     ],
     [
      0.6,
      -55
     ],
     [
      0.8,
      -55
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      55
     ],
     [
      0.42,
      42
     ],
     [
      0.6,
      55
     ],
     [
      0.8,
      55
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "pointLeft": {
  "id": "pointLeft",
  "name": "Point to the left",
  "words": [
   "left",
   "there",
   "over there",
   "look",
   "that one",
   "this way"
  ],
  "tags": [
   "aac",
   "gesture",
   "point",
   "direction"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.5,
  "face": "neutral",
  "tracks": {
   "shoulderL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      88
     ],
     [
      0.5,
      92
     ],
     [
      0.75,
      88
     ],
     [
      0.85,
      88
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "faceX": [
     [
      0,
      0
     ],
     [
      0.2,
      -8
     ],
     [
      0.85,
      -8
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "pointRight": {
  "id": "pointRight",
  "name": "Point right",
  "words": [
   "there",
   "that one",
   "look",
   "over there",
   "this way",
   "right",
   "that"
  ],
  "tags": [
   "aac",
   "gesture",
   "emote",
   "pointing"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.45,
  "face": "neutral",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -88
     ],
     [
      0.45,
      -92
     ],
     [
      0.65,
      -88
     ],
     [
      0.8,
      -88
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -3
     ],
     [
      0.45,
      -5
     ],
     [
      0.65,
      -3
     ],
     [
      0.8,
      -3
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      3
     ],
     [
      0.45,
      3
     ],
     [
      0.8,
      3
     ],
     [
      1,
      0
     ]
    ],
    "faceX": [
     [
      0,
      0
     ],
     [
      0.25,
      8
     ],
     [
      0.45,
      8
     ],
     [
      0.8,
      8
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "sad": {
  "id": "sad",
  "name": "Sad",
  "words": [
   "sad",
   "unhappy",
   "down",
   "upset",
   "feel bad",
   "miss"
  ],
  "tags": [
   "aac",
   "emote",
   "feeling"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.4,
  "face": "frown",
  "tracks": {
   "neck": {
    "y": [
     [
      0,
      3.5
     ],
     [
      0.4,
      5
     ],
     [
      1,
      3.5
     ]
    ],
    "rot": [
     [
      0,
      3
     ],
     [
      0.4,
      4
     ],
     [
      1,
      3
     ]
    ],
    "faceY": [
     [
      0,
      6
     ],
     [
      0.4,
      8
     ],
     [
      1,
      6
     ]
    ]
   },
   "shoulderL": {
    "y": [
     [
      0,
      3
     ],
     [
      0.4,
      4
     ],
     [
      1,
      3
     ]
    ],
    "rot": [
     [
      0,
      -2
     ],
     [
      0.4,
      -3
     ],
     [
      1,
      -2
     ]
    ]
   },
   "shoulderR": {
    "y": [
     [
      0,
      3
     ],
     [
      0.4,
      4
     ],
     [
      1,
      3
     ]
    ],
    "rot": [
     [
      0,
      2
     ],
     [
      0.4,
      3
     ],
     [
      1,
      2
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "scratchHead": {
  "id": "scratchHead",
  "name": "Scratch head (puzzled)",
  "words": [
   "confused",
   "puzzled",
   "not sure",
   "don't know",
   "hmm",
   "I wonder"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture",
   "feeling"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.2,
  "face": "puzzled",
  "pose": "wave",
  "tracks": {
   "elbowR": {
    "rot": [
     [
      0,
      -55
     ],
     [
      0.2,
      -68
     ],
     [
      0.37,
      -55
     ],
     [
      0.53,
      -68
     ],
     [
      0.7,
      -55
     ],
     [
      0.87,
      -68
     ],
     [
      1,
      -55
     ]
    ]
   },
   "wristR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      8
     ],
     [
      0.37,
      0
     ],
     [
      0.53,
      8
     ],
     [
      0.7,
      0
     ],
     [
      0.87,
      8
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      5
     ],
     [
      0.8,
      5
     ],
     [
      1,
      0
     ]
    ],
    "faceX": [
     [
      0,
      0
     ],
     [
      0.2,
      5
     ],
     [
      0.8,
      5
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.2,
      -3
     ],
     [
      0.8,
      -3
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "shrug": {
  "id": "shrug",
  "name": "Shrug (I don't know)",
  "words": [
   "don't know",
   "not sure",
   "maybe",
   "who knows",
   "oh well",
   "no idea"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 1600,
  "loop": true,
  "still": 0.5,
  "face": "puzzled",
  "tracks": {
   "shoulderL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      16
     ],
     [
      0.7,
      16
     ],
     [
      1,
      0
     ]
    ],
    "y": [
     [
      0,
      0
     ],
     [
      0.3,
      -6
     ],
     [
      0.7,
      -6
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      -16
     ],
     [
      0.7,
      -16
     ],
     [
      1,
      0
     ]
    ],
    "y": [
     [
      0,
      0
     ],
     [
      0.3,
      -6
     ],
     [
      0.7,
      -6
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      55
     ],
     [
      0.7,
      55
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      -55
     ],
     [
      0.7,
      -55
     ],
     [
      1,
      0
     ]
    ]
   },
   "wristL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      12
     ],
     [
      0.7,
      12
     ],
     [
      1,
      0
     ]
    ]
   },
   "wristR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      -12
     ],
     [
      0.7,
      -12
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      5
     ],
     [
      0.7,
      5
     ],
     [
      1,
      0
     ]
    ],
    "faceX": [
     [
      0,
      0
     ],
     [
      0.3,
      4
     ],
     [
      0.7,
      4
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.3,
      2
     ],
     [
      0.7,
      2
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "sigh": {
  "id": "sigh",
  "name": "Sigh",
  "words": [
   "sigh",
   "tired",
   "phew",
   "relief",
   "disappointed",
   "oh well"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.8,
  "face": "neutral",
  "tracks": {
   "shoulderL": {
    "y": [
     [
      0,
      0
     ],
     [
      0.3,
      -4
     ],
     [
      0.45,
      -4
     ],
     [
      0.8,
      3
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderR": {
    "y": [
     [
      0,
      0
     ],
     [
      0.3,
      -4
     ],
     [
      0.45,
      -4
     ],
     [
      0.8,
      3
     ],
     [
      1,
      0
     ]
    ]
   },
   "waist": {
    "y": [
     [
      0,
      0
     ],
     [
      0.3,
      -1
     ],
     [
      0.45,
      -1
     ],
     [
      0.8,
      2
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "y": [
     [
      0,
      0
     ],
     [
      0.3,
      -1
     ],
     [
      0.45,
      -1
     ],
     [
      0.8,
      3
     ],
     [
      1,
      0
     ]
    ],
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      0
     ],
     [
      0.45,
      0
     ],
     [
      0.8,
      3
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.3,
      -3
     ],
     [
      0.45,
      -3
     ],
     [
      0.8,
      6
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "sleepBreathe": {
  "id": "sleepBreathe",
  "name": "Sleeping breath",
  "words": [
   "sleep",
   "sleeping",
   "asleep",
   "tired",
   "rest",
   "nap",
   "bed",
   "goodnight",
   "night"
  ],
  "tags": [
   "aac",
   "emote",
   "rest",
   "calm"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.45,
  "face": "sleep",
  "tracks": {
   "neck": {
    "rot": [
     [
      0,
      3
     ],
     [
      0.45,
      3.5
     ],
     [
      1,
      3
     ]
    ],
    "y": [
     [
      0,
      0
     ],
     [
      0.45,
      -1
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      4
     ],
     [
      0.45,
      5.5
     ],
     [
      1,
      4
     ]
    ]
   },
   "waist": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.45,
      -0.6
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderL": {
    "y": [
     [
      0,
      0
     ],
     [
      0.45,
      -1.5
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderR": {
    "y": [
     [
      0,
      0
     ],
     [
      0.45,
      -1.5
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "stopHand": {
  "id": "stopHand",
  "name": "Stop (palm out)",
  "words": [
   "stop",
   "wait",
   "no more",
   "hold on",
   "not now",
   "enough",
   "don't"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.3,
  "face": "neutral",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      -70
     ],
     [
      0.55,
      -76
     ],
     [
      0.8,
      -70
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      -110
     ],
     [
      0.55,
      -104
     ],
     [
      0.8,
      -110
     ],
     [
      1,
      0
     ]
    ]
   },
   "wristR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      -8
     ],
     [
      0.55,
      -4
     ],
     [
      0.8,
      -8
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "stretch": {
  "id": "stretch",
  "name": "Stretch (cat)",
  "words": [
   "stretch",
   "wake up",
   "morning",
   "tired",
   "relax",
   "cozy"
  ],
  "tags": [
   "aac",
   "emote",
   "cat"
  ],
  "target": "body",
  "duration": 1800,
  "loop": false,
  "still": 0.5,
  "face": "happy",
  "tracks": {
   "neck": {
    "y": [
     [
      0,
      0
     ],
     [
      0.3,
      6
     ],
     [
      0.5,
      6
     ],
     [
      0.72,
      6
     ],
     [
      1,
      0
     ]
    ],
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      6
     ],
     [
      0.5,
      6
     ],
     [
      0.72,
      6
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.3,
      8
     ],
     [
      0.5,
      8
     ],
     [
      0.72,
      8
     ],
     [
      1,
      0
     ]
    ]
   },
   "tail": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      -18
     ],
     [
      0.5,
      -22
     ],
     [
      0.72,
      -22
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "surprised": {
  "id": "surprised",
  "name": "Surprised",
  "words": [
   "surprised",
   "surprise",
   "wow",
   "oh",
   "oh my",
   "really",
   "no way",
   "what"
  ],
  "tags": [
   "aac",
   "emote",
   "feeling"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.3,
  "face": "talk",
  "tracks": {
   "root": {
    "y": [
     [
      0,
      0
     ],
     [
      0.12,
      -6
     ],
     [
      0.3,
      -2
     ],
     [
      0.8,
      -2
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "y": [
     [
      0,
      0
     ],
     [
      0.14,
      -3
     ],
     [
      0.3,
      -2
     ],
     [
      0.8,
      -2
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.14,
      -7
     ],
     [
      0.3,
      -5
     ],
     [
      0.8,
      -5
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.15,
      32
     ],
     [
      0.3,
      28
     ],
     [
      0.8,
      28
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.15,
      -32
     ],
     [
      0.3,
      -28
     ],
     [
      0.8,
      -28
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.15,
      -85
     ],
     [
      0.3,
      -75
     ],
     [
      0.8,
      -75
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.15,
      85
     ],
     [
      0.3,
      75
     ],
     [
      0.8,
      75
     ],
     [
      1,
      0
     ]
    ]
   },
   "wristL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.15,
      -10
     ],
     [
      0.3,
      -8
     ],
     [
      0.8,
      -8
     ],
     [
      1,
      0
     ]
    ]
   },
   "wristR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.15,
      10
     ],
     [
      0.3,
      8
     ],
     [
      0.8,
      8
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "sway": {
  "id": "sway",
  "name": "Sway (dance)",
  "words": [
   "dance",
   "sway",
   "music",
   "song",
   "party",
   "happy",
   "relax"
  ],
  "tags": [
   "aac",
   "emote",
   "feeling",
   "dance"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.25,
  "face": "happy",
  "tracks": {
   "waist": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      3
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -3
     ],
     [
      1,
      0
     ]
    ],
    "x": [
     [
      0,
      0
     ],
     [
      0.25,
      6
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -6
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -2
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      2
     ],
     [
      1,
      0
     ]
    ],
    "faceX": [
     [
      0,
      0
     ],
     [
      0.25,
      3
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -3
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      6
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -6
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      6
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -6
     ],
     [
      1,
      0
     ]
    ]
   },
   "root": {
    "y": [
     [
      0,
      0
     ],
     [
      0.25,
      -2
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -2
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "tailSwish": {
  "id": "tailSwish",
  "name": "Tail swish",
  "words": [
   "cat",
   "tail",
   "happy",
   "playful",
   "content",
   "swish"
  ],
  "tags": [
   "cat",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.25,
  "face": "happy",
  "tracks": {
   "tail": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      18
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -18
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "faceX": [
     [
      0,
      0
     ],
     [
      0.25,
      3
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -3
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "think": {
  "id": "think",
  "name": "Think (hand to chin)",
  "words": [
   "think",
   "thinking",
   "hmm",
   "wonder",
   "maybe",
   "remember",
   "idea",
   "let me think"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture",
   "feeling"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.5,
  "face": "think",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      -22
     ],
     [
      0.7,
      -22
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      142
     ],
     [
      0.7,
      142
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      3
     ],
     [
      0.7,
      3
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.3,
      -3
     ],
     [
      0.7,
      -3
     ],
     [
      1,
      0
     ]
    ],
    "faceX": [
     [
      0,
      0
     ],
     [
      0.3,
      -4
     ],
     [
      0.7,
      -4
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "walkAcross": {
  "id": "walkAcross",
  "name": "Walk across (left to right)",
  "words": [
   "walk across",
   "cross",
   "pass by",
   "go past",
   "walk",
   "travel",
   "go along"
  ],
  "tags": [
   "move",
   "piece",
   "aac"
  ],
  "target": "piece",
  "duration": 7000,
  "loop": false,
  "still": 0.5,
  "tracks": {
   "root": {
    "x": [
     [
      0,
      -560
     ],
     [
      1,
      560
     ]
    ],
    "opacity": [
     [
      0,
      0
     ],
     [
      0.08,
      1
     ],
     [
      0.92,
      1
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "want": {
  "id": "want",
  "name": "Want (reach out)",
  "words": [
   "want",
   "I want",
   "give me",
   "reach",
   "mine",
   "can I have"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.45,
  "face": "happy",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -72
     ],
     [
      0.45,
      -82
     ],
     [
      0.65,
      -74
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -8
     ],
     [
      0.45,
      -14
     ],
     [
      0.65,
      -8
     ],
     [
      1,
      0
     ]
    ]
   },
   "waist": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      2
     ],
     [
      0.45,
      3
     ],
     [
      0.65,
      2
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      2
     ],
     [
      0.45,
      3
     ],
     [
      0.65,
      2
     ],
     [
      1,
      0
     ]
    ],
    "faceX": [
     [
      0,
      0
     ],
     [
      0.25,
      3
     ],
     [
      0.45,
      4
     ],
     [
      0.65,
      3
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "yawn": {
  "id": "yawn",
  "name": "Yawn (sleepy)",
  "words": [
   "yawn",
   "tired",
   "sleepy",
   "sleep",
   "bedtime",
   "night"
  ],
  "tags": [
   "aac",
   "emote",
   "feeling"
  ],
  "target": "body",
  "duration": 2000,
  "loop": false,
  "still": 0.55,
  "face": "sleep",
  "tracks": {
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      0
     ],
     [
      0.5,
      -3
     ],
     [
      0.7,
      -3
     ],
     [
      0.88,
      1
     ],
     [
      1,
      0
     ]
    ],
    "y": [
     [
      0,
      0
     ],
     [
      0.2,
      0
     ],
     [
      0.5,
      -3
     ],
     [
      0.7,
      -3
     ],
     [
      0.88,
      1
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.2,
      -2
     ],
     [
      0.45,
      -8
     ],
     [
      0.7,
      -8
     ],
     [
      0.88,
      2
     ],
     [
      1,
      0
     ]
    ]
   },
   "waist": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      0
     ],
     [
      0.5,
      -2
     ],
     [
      0.7,
      -2
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      2
     ],
     [
      0.5,
      10
     ],
     [
      0.7,
      10
     ],
     [
      0.9,
      2
     ],
     [
      1,
      0
     ]
    ],
    "y": [
     [
      0,
      0
     ],
     [
      0.2,
      0
     ],
     [
      0.5,
      -2
     ],
     [
      0.7,
      -2
     ],
     [
      0.9,
      1
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      -2
     ],
     [
      0.5,
      -10
     ],
     [
      0.7,
      -10
     ],
     [
      0.9,
      -2
     ],
     [
      1,
      0
     ]
    ],
    "y": [
     [
      0,
      0
     ],
     [
      0.2,
      0
     ],
     [
      0.5,
      -2
     ],
     [
      0.7,
      -2
     ],
     [
      0.9,
      1
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.5,
      4
     ],
     [
      0.7,
      4
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.5,
      -4
     ],
     [
      0.7,
      -4
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-02"
 },
 "bat": {
  "id": "bat",
  "name": "Bat (flap like wings)",
  "words": [
   "bat",
   "wings",
   "flap",
   "fly",
   "play"
  ],
  "tags": [
   "emote",
   "gesture",
   "play"
  ],
  "target": "body",
  "duration": 1600,
  "loop": true,
  "still": 0.25,
  "face": "happy",
  "tracks": {
   "shoulderL": {
    "rot": [
     [
      0,
      40
     ],
     [
      0.25,
      80
     ],
     [
      0.5,
      40
     ],
     [
      0.75,
      80
     ],
     [
      1,
      40
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      -40
     ],
     [
      0.25,
      -80
     ],
     [
      0.5,
      -40
     ],
     [
      0.75,
      -80
     ],
     [
      1,
      -40
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      2
     ],
     [
      0.3,
      10
     ],
     [
      0.55,
      2
     ],
     [
      0.8,
      10
     ],
     [
      1,
      2
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      -2
     ],
     [
      0.3,
      -10
     ],
     [
      0.55,
      -2
     ],
     [
      0.8,
      -10
     ],
     [
      1,
      -2
     ]
    ]
   },
   "root": {
    "y": [
     [
      0,
      0
     ],
     [
      0.25,
      -3
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -3
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "blowKiss": {
  "id": "blowKiss",
  "name": "Blow a kiss",
  "words": [
   "kiss",
   "blow a kiss",
   "love",
   "love you",
   "thank you",
   "like",
   "fond",
   "miss you"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture",
   "feeling"
  ],
  "target": "body",
  "duration": 1800,
  "loop": false,
  "still": 0.65,
  "face": "happy",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      -15
     ],
     [
      0.45,
      -15
     ],
     [
      0.65,
      -75
     ],
     [
      0.78,
      -72
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      150
     ],
     [
      0.45,
      150
     ],
     [
      0.65,
      25
     ],
     [
      0.78,
      25
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      2
     ],
     [
      0.45,
      2
     ],
     [
      0.65,
      4
     ],
     [
      0.78,
      4
     ],
     [
      1,
      0
     ]
    ],
    "faceX": [
     [
      0,
      0
     ],
     [
      0.3,
      2
     ],
     [
      0.45,
      2
     ],
     [
      0.65,
      4
     ],
     [
      0.78,
      4
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.3,
      2
     ],
     [
      0.45,
      2
     ],
     [
      0.65,
      -2
     ],
     [
      0.78,
      -2
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-03"
 },
 "candy": {
  "id": "candy",
  "name": "Candy (hand to mouth)",
  "words": [
   "candy",
   "sweet",
   "sweets",
   "treat",
   "lollipop",
   "yummy"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture",
   "food"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.3,
  "face": "happy",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      -28
     ],
     [
      0.6,
      -28
     ],
     [
      0.88,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      138
     ],
     [
      0.45,
      126
     ],
     [
      0.6,
      138
     ],
     [
      0.88,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "y": [
     [
      0,
      0
     ],
     [
      0.3,
      1
     ],
     [
      0.45,
      2
     ],
     [
      0.6,
      1
     ],
     [
      0.88,
      0
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.3,
      2
     ],
     [
      0.45,
      4
     ],
     [
      0.6,
      2
     ],
     [
      0.88,
      0
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "catLoaf": {
  "id": "catLoaf",
  "name": "Cat loaf (settle and breathe)",
  "words": [
   "rest",
   "relax",
   "calm",
   "cozy",
   "tired",
   "sleepy",
   "quiet",
   "wait"
  ],
  "tags": [
   "emote",
   "cat",
   "rest",
   "loop"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0,
  "face": "happy",
  "tracks": {
   "root": {
    "scale": [
     [
      0,
      1
     ],
     [
      0.45,
      1.02
     ],
     [
      1,
      1
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      3
     ],
     [
      0.45,
      2
     ],
     [
      1,
      3
     ]
    ],
    "y": [
     [
      0,
      3
     ],
     [
      0.45,
      1.5
     ],
     [
      1,
      3
     ]
    ],
    "faceY": [
     [
      0,
      4
     ],
     [
      0.45,
      2
     ],
     [
      1,
      4
     ]
    ]
   },
   "tail": {
    "rot": [
     [
      0,
      18
     ],
     [
      0.5,
      21
     ],
     [
      1,
      18
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-03"
 },
 "catPlay": {
  "id": "catPlay",
  "name": "Cat play (tail and head bob)",
  "words": [
   "play",
   "playful",
   "fun",
   "happy",
   "want to play",
   "let's play"
  ],
  "tags": [
   "emote",
   "cat",
   "play",
   "aac"
  ],
  "target": "body",
  "duration": 1600,
  "loop": true,
  "still": 0.25,
  "face": "happy",
  "tracks": {
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -5
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      5
     ],
     [
      1,
      0
     ]
    ],
    "y": [
     [
      0,
      0
     ],
     [
      0.25,
      3
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      3
     ],
     [
      1,
      0
     ]
    ],
    "faceX": [
     [
      0,
      0
     ],
     [
      0.25,
      -6
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      6
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.25,
      5
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      5
     ],
     [
      1,
      0
     ]
    ]
   },
   "tail": {
    "rot": [
     [
      0,
      -10
     ],
     [
      0.25,
      10
     ],
     [
      0.5,
      -10
     ],
     [
      0.75,
      10
     ],
     [
      1,
      -10
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-03"
 },
 "celebrate": {
  "id": "celebrate",
  "name": "Celebrate (hooray)",
  "words": [
   "celebrate",
   "hooray",
   "yay",
   "party",
   "win",
   "well done",
   "good news"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture",
   "feeling"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.3,
  "face": "happy",
  "tracks": {
   "shoulderL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      150
     ],
     [
      0.3,
      156
     ],
     [
      0.42,
      150
     ],
     [
      0.58,
      150
     ],
     [
      0.7,
      156
     ],
     [
      0.82,
      150
     ],
     [
      0.82,
      150
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      -150
     ],
     [
      0.3,
      -156
     ],
     [
      0.42,
      -150
     ],
     [
      0.58,
      -150
     ],
     [
      0.7,
      -156
     ],
     [
      0.82,
      -150
     ],
     [
      0.82,
      -150
     ],
     [
      1,
      0
     ]
    ]
   },
   "root": {
    "y": [
     [
      0,
      0
     ],
     [
      0.18,
      0
     ],
     [
      0.3,
      -14
     ],
     [
      0.42,
      0
     ],
     [
      0.58,
      0
     ],
     [
      0.7,
      -14
     ],
     [
      0.82,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "kneeL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.18,
      0
     ],
     [
      0.3,
      10
     ],
     [
      0.42,
      0
     ],
     [
      0.58,
      0
     ],
     [
      0.7,
      10
     ],
     [
      0.82,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "kneeR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.18,
      0
     ],
     [
      0.3,
      10
     ],
     [
      0.42,
      0
     ],
     [
      0.58,
      0
     ],
     [
      0.7,
      10
     ],
     [
      0.82,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "faceY": [
     [
      0,
      0
     ],
     [
      0.2,
      -4
     ],
     [
      0.8,
      -4
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-03"
 },
 "dad": {
  "id": "dad",
  "name": "Dad (a warm wave)",
  "words": [
   "dad",
   "daddy",
   "papa",
   "father",
   "my dad",
   "see dad",
   "dad is here"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture",
   "family"
  ],
  "target": "body",
  "duration": 1600,
  "loop": true,
  "still": 0.25,
  "face": "happy",
  "pose": "wave",
  "tracks": {
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -16
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -16
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.5,
      3
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.5,
      2
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "danceArms": {
  "id": "danceArms",
  "name": "Arm-swing dance",
  "words": [
   "dance",
   "music",
   "party",
   "celebrate",
   "fun",
   "swing"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture",
   "dance"
  ],
  "target": "body",
  "duration": 1600,
  "loop": true,
  "still": 0.25,
  "face": "happy",
  "tracks": {
   "root": {
    "y": [
     [
      0,
      0
     ],
     [
      0.125,
      -4
     ],
     [
      0.25,
      0
     ],
     [
      0.375,
      -4
     ],
     [
      0.5,
      0
     ],
     [
      0.625,
      -4
     ],
     [
      0.75,
      0
     ],
     [
      0.875,
      -4
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderL": {
    "rot": [
     [
      0,
      6
     ],
     [
      0.25,
      70
     ],
     [
      0.5,
      6
     ],
     [
      1,
      6
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      -6
     ],
     [
      0.5,
      -6
     ],
     [
      0.75,
      -70
     ],
     [
      1,
      -6
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      20
     ],
     [
      0.5,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -20
     ],
     [
      1,
      0
     ]
    ]
   },
   "waist": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -3
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      3
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -3
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      3
     ],
     [
      1,
      0
     ]
    ],
    "faceX": [
     [
      0,
      0
     ],
     [
      0.25,
      -4
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      4
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-03"
 },
 "danceSideStep": {
  "id": "danceSideStep",
  "name": "Dance (side step)",
  "words": [
   "dance",
   "music",
   "party",
   "celebrate",
   "fun",
   "song"
  ],
  "tags": [
   "aac",
   "emote",
   "dance",
   "loop"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.25,
  "face": "happy",
  "tracks": {
   "root": {
    "x": [
     [
      0,
      0
     ],
     [
      0.25,
      22
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -22
     ],
     [
      1,
      0
     ]
    ],
    "y": [
     [
      0,
      0
     ],
     [
      0.25,
      -3
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -3
     ],
     [
      1,
      0
     ]
    ]
   },
   "waist": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      4
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -4
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      3
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -3
     ],
     [
      1,
      0
     ]
    ],
    "faceX": [
     [
      0,
      0
     ],
     [
      0.25,
      5
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -5
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -32
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      8
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -8
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      32
     ],
     [
      1,
      0
     ]
    ]
   },
   "hipR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -12
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "hipL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      0
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      12
     ],
     [
      1,
      0
     ]
    ]
   },
   "kneeL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      8
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      8
     ],
     [
      1,
      0
     ]
    ]
   },
   "kneeR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      8
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      8
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-03"
 },
 "doIt": {
  "id": "doIt",
  "name": "Do it (hands busy)",
  "words": [
   "do",
   "doing",
   "make",
   "work",
   "busy",
   "do it",
   "my turn"
  ],
  "tags": [
   "aac",
   "gesture",
   "action"
  ],
  "target": "body",
  "duration": 1600,
  "loop": true,
  "still": 0.5,
  "face": "neutral",
  "tracks": {
   "shoulderL": {
    "rot": [
     [
      0,
      10
     ],
     [
      1,
      10
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      -10
     ],
     [
      1,
      -10
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      -60
     ],
     [
      0.25,
      -68
     ],
     [
      0.5,
      -60
     ],
     [
      0.75,
      -52
     ],
     [
      1,
      -60
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      60
     ],
     [
      0.25,
      52
     ],
     [
      0.5,
      60
     ],
     [
      0.75,
      68
     ],
     [
      1,
      60
     ]
    ]
   },
   "wristL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      10
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -10
     ],
     [
      1,
      0
     ]
    ]
   },
   "wristR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -10
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      10
     ],
     [
      1,
      0
     ]
    ]
   },
   "waist": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      1.5
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -1.5
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "faceY": [
     [
      0,
      5
     ],
     [
      0.5,
      6
     ],
     [
      1,
      5
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "down": {
  "id": "down",
  "name": "Down (point down)",
  "words": [
   "down",
   "below",
   "under",
   "floor",
   "ground",
   "look down",
   "put down",
   "there (low)"
  ],
  "tags": [
   "aac",
   "gesture",
   "direction"
  ],
  "target": "body",
  "duration": 1600,
  "loop": true,
  "still": 0.2,
  "face": "neutral",
  "tracks": {
   "neck": {
    "faceY": [
     [
      0,
      0
     ],
     [
      0.2,
      7
     ],
     [
      0.4,
      7
     ],
     [
      0.6,
      7
     ],
     [
      0.8,
      7
     ],
     [
      1,
      0
     ]
    ],
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      2
     ],
     [
      0.8,
      2
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      -8
     ],
     [
      0.2,
      -26
     ],
     [
      0.4,
      -24
     ],
     [
      0.6,
      -26
     ],
     [
      0.8,
      -24
     ],
     [
      1,
      -8
     ]
    ]
   },
   "wristR": {
    "y": [
     [
      0,
      0
     ],
     [
      0.2,
      0
     ],
     [
      0.35,
      5
     ],
     [
      0.5,
      0
     ],
     [
      0.65,
      5
     ],
     [
      0.8,
      0
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "facepalm": {
  "id": "facepalm",
  "name": "Facepalm (oops)",
  "words": [
   "oops",
   "my mistake",
   "silly me",
   "forgot",
   "oh no",
   "embarrassed",
   "I made a mistake"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.5,
  "face": "puzzled",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      -125
     ],
     [
      0.7,
      -125
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      -105
     ],
     [
      0.7,
      -105
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      3
     ],
     [
      0.7,
      3
     ],
     [
      1,
      0
     ]
    ],
    "y": [
     [
      0,
      0
     ],
     [
      0.3,
      3
     ],
     [
      0.7,
      3
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.3,
      6
     ],
     [
      0.7,
      6
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-03"
 },
 "ghost": {
  "id": "ghost",
  "name": "Friendly ghost (float and sway)",
  "words": [
   "ghost",
   "float",
   "floating",
   "pretend",
   "Halloween",
   "play"
  ],
  "tags": [
   "emote",
   "play",
   "float"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.25,
  "face": "happy",
  "tracks": {
   "root": {
    "y": [
     [
      0,
      0
     ],
     [
      0.25,
      -8
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -8
     ],
     [
      1,
      0
     ]
    ],
    "x": [
     [
      0,
      0
     ],
     [
      0.25,
      6
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -6
     ],
     [
      1,
      0
     ]
    ]
   },
   "waist": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      3
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -3
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      3
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -3
     ],
     [
      1,
      0
     ]
    ],
    "faceX": [
     [
      0,
      0
     ],
     [
      0.25,
      4
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -4
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.25,
      2
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      2
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderL": {
    "rot": [
     [
      0,
      30
     ],
     [
      0.25,
      36
     ],
     [
      0.5,
      30
     ],
     [
      0.75,
      36
     ],
     [
      1,
      30
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      -30
     ],
     [
      0.3,
      -36
     ],
     [
      0.55,
      -30
     ],
     [
      0.8,
      -36
     ],
     [
      1,
      -30
     ]
    ]
   },
   "wristL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      6
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -6
     ],
     [
      1,
      0
     ]
    ]
   },
   "wristR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      -6
     ],
     [
      0.55,
      0
     ],
     [
      0.8,
      6
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "headTilt": {
  "id": "headTilt",
  "name": "Head tilt (curious)",
  "words": [
   "curious",
   "wonder",
   "what",
   "why",
   "huh",
   "I wonder",
   "interested",
   "not sure"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.4,
  "face": "puzzled",
  "tracks": {
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      7
     ],
     [
      0.7,
      7
     ],
     [
      1,
      0
     ]
    ],
    "faceX": [
     [
      0,
      0
     ],
     [
      0.25,
      4
     ],
     [
      0.7,
      4
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.25,
      -2
     ],
     [
      0.7,
      -2
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-03"
 },
 "hug": {
  "id": "hug",
  "name": "Hug (arms open)",
  "words": [
   "hug",
   "hug me",
   "give a hug",
   "love",
   "comfort",
   "care",
   "close"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.5,
  "face": "happy",
  "tracks": {
   "shoulderL": {
    "rot": [
     [
      0,
      58
     ],
     [
      0.5,
      76
     ],
     [
      1,
      58
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      -58
     ],
     [
      0.5,
      -76
     ],
     [
      1,
      -58
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      12
     ],
     [
      0.5,
      26
     ],
     [
      1,
      12
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      -12
     ],
     [
      0.5,
      -26
     ],
     [
      1,
      -12
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.5,
      3
     ],
     [
      1,
      0
     ]
    ],
    "faceX": [
     [
      0,
      0
     ],
     [
      0.5,
      3
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-03"
 },
 "i": {
  "id": "i",
  "name": "I (point to self)",
  "words": [
   "I",
   "me",
   "my",
   "myself",
   "mine"
  ],
  "tags": [
   "aac",
   "gesture",
   "body"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.25,
  "face": "happy",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -8
     ],
     [
      0.8,
      -8
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      112
     ],
     [
      0.4,
      120
     ],
     [
      0.55,
      112
     ],
     [
      0.7,
      120
     ],
     [
      0.8,
      112
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "faceY": [
     [
      0,
      0
     ],
     [
      0.25,
      3
     ],
     [
      0.8,
      3
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "idleBreathe": {
  "id": "idleBreathe",
  "name": "Idle breathing",
  "words": [
   "breathe",
   "calm",
   "relax",
   "wait",
   "rest",
   "stand",
   "okay"
  ],
  "tags": [
   "emote",
   "idle",
   "calm",
   "loop"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0,
  "face": "neutral",
  "tracks": {
   "shoulderL": {
    "y": [
     [
      0,
      0
     ],
     [
      0.4,
      -2
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderR": {
    "y": [
     [
      0,
      0
     ],
     [
      0.4,
      -2
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "y": [
     [
      0,
      0
     ],
     [
      0.4,
      -1
     ],
     [
      1,
      0
     ]
    ]
   },
   "waist": {
    "x": [
     [
      0,
      0
     ],
     [
      0.5,
      2
     ],
     [
      1,
      0
     ]
    ],
    "rot": [
     [
      0,
      0
     ],
     [
      0.5,
      1
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-03"
 },
 "inside": {
  "id": "inside",
  "name": "Inside (point down and in)",
  "words": [
   "inside",
   "in",
   "into",
   "within",
   "in here"
  ],
  "tags": [
   "aac",
   "gesture",
   "emote"
  ],
  "target": "body",
  "duration": 1600,
  "loop": true,
  "still": 0.3,
  "face": "neutral",
  "tracks": {
   "neck": {
    "faceY": [
     [
      0,
      0
     ],
     [
      0.25,
      7
     ],
     [
      0.75,
      7
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -12
     ],
     [
      0.75,
      -12
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      55
     ],
     [
      0.4,
      46
     ],
     [
      0.55,
      58
     ],
     [
      0.7,
      48
     ],
     [
      0.8,
      52
     ],
     [
      1,
      0
     ]
    ]
   },
   "wristR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      12
     ],
     [
      0.75,
      12
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "keyboard": {
  "id": "keyboard",
  "name": "Keyboard (typing)",
  "words": [
   "keyboard",
   "type",
   "typing",
   "computer",
   "write",
   "email",
   "message",
   "work"
  ],
  "tags": [
   "aac",
   "gesture",
   "action"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.25,
  "face": "neutral",
  "tracks": {
   "shoulderL": {
    "rot": [
     [
      0,
      6
     ],
     [
      1,
      6
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      -6
     ],
     [
      1,
      -6
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      -75
     ],
     [
      1,
      -75
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      75
     ],
     [
      1,
      75
     ]
    ]
   },
   "wristL": {
    "y": [
     [
      0,
      0
     ],
     [
      0.125,
      3
     ],
     [
      0.25,
      0
     ],
     [
      0.5,
      0
     ],
     [
      0.625,
      3
     ],
     [
      0.75,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "wristR": {
    "y": [
     [
      0,
      0
     ],
     [
      0.25,
      0
     ],
     [
      0.375,
      3
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      0
     ],
     [
      0.875,
      3
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "faceY": [
     [
      0,
      4
     ],
     [
      1,
      4
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "make": {
  "id": "make",
  "name": "Make (shape something)",
  "words": [
   "make",
   "build",
   "create",
   "craft",
   "shape",
   "do"
  ],
  "tags": [
   "aac",
   "gesture",
   "action"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.5,
  "face": "happy",
  "tracks": {
   "shoulderL": {
    "rot": [
     [
      0,
      34
     ],
     [
      0.25,
      24
     ],
     [
      0.5,
      34
     ],
     [
      0.75,
      24
     ],
     [
      1,
      34
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      -34
     ],
     [
      0.25,
      -24
     ],
     [
      0.5,
      -34
     ],
     [
      0.75,
      -24
     ],
     [
      1,
      -34
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      -105
     ],
     [
      0.25,
      -115
     ],
     [
      0.5,
      -105
     ],
     [
      0.75,
      -115
     ],
     [
      1,
      -105
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      105
     ],
     [
      0.25,
      115
     ],
     [
      0.5,
      105
     ],
     [
      0.75,
      115
     ],
     [
      1,
      105
     ]
    ]
   },
   "neck": {
    "faceY": [
     [
      0,
      3
     ],
     [
      0.5,
      4
     ],
     [
      1,
      3
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "mom": {
  "id": "mom",
  "name": "Mom (a warm little wave)",
  "words": [
   "mom",
   "mum",
   "mommy",
   "mother",
   "mama",
   "see mom",
   "there's mom"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture",
   "family"
  ],
  "target": "body",
  "duration": 1600,
  "loop": true,
  "still": 0.25,
  "face": "happy",
  "pose": "wave",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      45
     ],
     [
      1,
      45
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -16
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -16
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      3
     ],
     [
      0.8,
      3
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.2,
      3
     ],
     [
      0.8,
      3
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "my": {
  "id": "my",
  "name": "My (hand flat to chest)",
  "words": [
   "my",
   "mine",
   "me",
   "I",
   "myself",
   "belongs to me"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.45,
  "face": "neutral",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      -6
     ],
     [
      0.45,
      -6
     ],
     [
      0.6,
      -6
     ],
     [
      0.8,
      -6
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      112
     ],
     [
      0.45,
      118
     ],
     [
      0.6,
      112
     ],
     [
      0.8,
      112
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "faceY": [
     [
      0,
      0
     ],
     [
      0.3,
      2
     ],
     [
      0.45,
      3
     ],
     [
      0.6,
      2
     ],
     [
      0.8,
      2
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "nodSlow": {
  "id": "nodSlow",
  "name": "Slow nod (thoughtful yes)",
  "words": [
   "yes",
   "I agree",
   "I see",
   "I understand",
   "okay",
   "sure",
   "I think so"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.3,
  "face": "neutral",
  "tracks": {
   "neck": {
    "y": [
     [
      0,
      0
     ],
     [
      0.15,
      2
     ],
     [
      0.3,
      4
     ],
     [
      0.45,
      2
     ],
     [
      0.6,
      0
     ],
     [
      1,
      0
     ]
    ],
    "rot": [
     [
      0,
      0
     ],
     [
      0.15,
      1.5
     ],
     [
      0.3,
      3
     ],
     [
      0.45,
      1.5
     ],
     [
      0.6,
      0
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.15,
      3.5
     ],
     [
      0.3,
      7
     ],
     [
      0.45,
      3.5
     ],
     [
      0.6,
      0
     ],
     [
      0.75,
      -1
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-03"
 },
 "off": {
  "id": "off",
  "name": "Off (hand lifts off the other)",
  "words": [
   "off",
   "take off",
   "remove",
   "get off",
   "turn off",
   "lift off"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.55,
  "face": "neutral",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      18
     ],
     [
      1,
      18
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      80
     ],
     [
      1,
      80
     ]
    ]
   },
   "shoulderL": {
    "rot": [
     [
      0,
      -18
     ],
     [
      0.15,
      -18
     ],
     [
      0.45,
      4
     ],
     [
      0.7,
      4
     ],
     [
      0.9,
      -18
     ],
     [
      1,
      -18
     ]
    ],
    "y": [
     [
      0,
      0
     ],
     [
      0.15,
      0
     ],
     [
      0.45,
      -10
     ],
     [
      0.7,
      -10
     ],
     [
      0.9,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      -80
     ],
     [
      0.15,
      -80
     ],
     [
      0.45,
      -62
     ],
     [
      0.7,
      -62
     ],
     [
      0.9,
      -80
     ],
     [
      1,
      -80
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "on": {
  "id": "on",
  "name": "On (hand pats down on the other)",
  "words": [
   "on",
   "on top",
   "onto",
   "put on",
   "upon"
  ],
  "tags": [
   "aac",
   "gesture",
   "position"
  ],
  "target": "body",
  "duration": 1600,
  "loop": true,
  "still": 0.2,
  "face": "neutral",
  "tracks": {
   "shoulderL": {
    "rot": [
     [
      0,
      12
     ],
     [
      1,
      12
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      -78
     ],
     [
      1,
      -78
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      -14
     ],
     [
      1,
      -14
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      104
     ],
     [
      0.2,
      84
     ],
     [
      0.35,
      100
     ],
     [
      0.55,
      84
     ],
     [
      0.7,
      100
     ],
     [
      1,
      104
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "open": {
  "id": "open",
  "name": "Open (hands part)",
  "words": [
   "open",
   "open it",
   "open the box",
   "open the door",
   "open up",
   "unwrap",
   "show me"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.55,
  "face": "neutral",
  "tracks": {
   "shoulderL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.15,
      0
     ],
     [
      0.45,
      48
     ],
     [
      0.7,
      48
     ],
     [
      0.95,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.15,
      0
     ],
     [
      0.45,
      -48
     ],
     [
      0.7,
      -48
     ],
     [
      0.95,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "faceY": [
     [
      0,
      0
     ],
     [
      0.15,
      0
     ],
     [
      0.45,
      3
     ],
     [
      0.7,
      3
     ],
     [
      0.95,
      0
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "out": {
  "id": "out",
  "name": "Outside (point out and away)",
  "words": [
   "out",
   "outside",
   "go out",
   "outdoors",
   "away",
   "over there"
  ],
  "tags": [
   "aac",
   "gesture",
   "emote"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.5,
  "face": "neutral",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -85
     ],
     [
      0.45,
      -93
     ],
     [
      0.6,
      -85
     ],
     [
      0.8,
      -85
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      3
     ],
     [
      0.8,
      3
     ],
     [
      1,
      0
     ]
    ],
    "faceX": [
     [
      0,
      0
     ],
     [
      0.25,
      6
     ],
     [
      0.8,
      6
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "peekaboo": {
  "id": "peekaboo",
  "name": "Peekaboo",
  "words": [
   "peekaboo",
   "peek-a-boo",
   "hide",
   "where did it go",
   "surprise",
   "play",
   "game",
   "boo"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture",
   "play"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.4,
  "face": "happy",
  "tracks": {
   "shoulderL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      45
     ],
     [
      0.55,
      45
     ],
     [
      0.68,
      70
     ],
     [
      0.84,
      70
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      -45
     ],
     [
      0.55,
      -45
     ],
     [
      0.68,
      -70
     ],
     [
      0.84,
      -70
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      -165
     ],
     [
      0.55,
      -165
     ],
     [
      0.68,
      -60
     ],
     [
      0.84,
      -60
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      165
     ],
     [
      0.55,
      165
     ],
     [
      0.68,
      60
     ],
     [
      0.84,
      60
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.55,
      0
     ],
     [
      0.68,
      3
     ],
     [
      0.84,
      3
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.55,
      0
     ],
     [
      0.68,
      3
     ],
     [
      0.84,
      3
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-03"
 },
 "pumpkin": {
  "id": "pumpkin",
  "name": "Pumpkin (big round thing held in the arms)",
  "words": [
   "pumpkin",
   "big",
   "round",
   "hold",
   "carry",
   "autumn",
   "harvest",
   "Halloween"
  ],
  "tags": [
   "aac",
   "gesture",
   "noun",
   "autumn"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0,
  "face": "happy",
  "tracks": {
   "shoulderL": {
    "rot": [
     [
      0,
      34
     ],
     [
      0.5,
      37
     ],
     [
      1,
      34
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      -34
     ],
     [
      0.5,
      -37
     ],
     [
      1,
      -34
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      -85
     ],
     [
      0.5,
      -89
     ],
     [
      1,
      -85
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      85
     ],
     [
      0.5,
      89
     ],
     [
      1,
      85
     ]
    ]
   },
   "neck": {
    "faceY": [
     [
      0,
      5
     ],
     [
      0.5,
      6
     ],
     [
      1,
      5
     ]
    ]
   },
   "root": {
    "y": [
     [
      0,
      0
     ],
     [
      0.5,
      2
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "put": {
  "id": "put",
  "name": "Put (set down)",
  "words": [
   "put",
   "put down",
   "set down",
   "place",
   "lay down",
   "here"
  ],
  "tags": [
   "aac",
   "gesture",
   "action"
  ],
  "target": "body",
  "duration": 1800,
  "loop": false,
  "still": 0.5,
  "face": "neutral",
  "tracks": {
   "shoulderL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      30
     ],
     [
      0.5,
      22
     ],
     [
      0.68,
      22
     ],
     [
      0.88,
      8
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -30
     ],
     [
      0.5,
      -22
     ],
     [
      0.68,
      -22
     ],
     [
      0.88,
      -8
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      35
     ],
     [
      0.5,
      12
     ],
     [
      0.68,
      12
     ],
     [
      0.88,
      8
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -35
     ],
     [
      0.5,
      -12
     ],
     [
      0.68,
      -12
     ],
     [
      0.88,
      -8
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "y": [
     [
      0,
      0
     ],
     [
      0.25,
      1
     ],
     [
      0.5,
      2
     ],
     [
      0.68,
      2
     ],
     [
      0.88,
      0
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.25,
      4
     ],
     [
      0.5,
      7
     ],
     [
      0.68,
      7
     ],
     [
      0.88,
      2
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "rise": {
  "id": "rise",
  "name": "Rise up (fade in)",
  "words": [
   "rise",
   "up",
   "wake up",
   "appear",
   "get up"
  ],
  "tags": [
   "move",
   "piece",
   "aac"
  ],
  "target": "piece",
  "duration": 1800,
  "loop": false,
  "still": 1,
  "tracks": {
   "root": {
    "y": [
     [
      0,
      60
     ],
     [
      1,
      0
     ]
    ],
    "opacity": [
     [
      0,
      0
     ],
     [
      0.4,
      1
     ],
     [
      1,
      1
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-03"
 },
 "run": {
  "id": "run",
  "name": "Run (gentle jog in place)",
  "words": [
   "run",
   "jog",
   "running",
   "hurry",
   "fast",
   "race",
   "exercise",
   "play"
  ],
  "tags": [
   "aac",
   "move",
   "cycle"
  ],
  "target": "body",
  "duration": 1100,
  "loop": true,
  "still": 0.3,
  "face": "happy",
  "tracks": {
   "root": {
    "y": [
     [
      0,
      0
     ],
     [
      0.25,
      -5
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -5
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "y": [
     [
      0,
      0
     ],
     [
      0.25,
      1
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      1
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.25,
      2
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      2
     ],
     [
      1,
      0
     ]
    ]
   },
   "hipL": {
    "rot": [
     [
      0,
      18
     ],
     [
      0.5,
      -18
     ],
     [
      1,
      18
     ]
    ]
   },
   "hipR": {
    "rot": [
     [
      0,
      -18
     ],
     [
      0.5,
      18
     ],
     [
      1,
      -18
     ]
    ]
   },
   "kneeL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.15,
      24
     ],
     [
      0.3,
      44
     ],
     [
      0.42,
      20
     ],
     [
      0.5,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "kneeR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.5,
      0
     ],
     [
      0.65,
      24
     ],
     [
      0.8,
      44
     ],
     [
      0.92,
      20
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderL": {
    "rot": [
     [
      0,
      -18
     ],
     [
      0.5,
      18
     ],
     [
      1,
      -18
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      18
     ],
     [
      0.5,
      -18
     ],
     [
      1,
      18
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      -32
     ],
     [
      0.5,
      -44
     ],
     [
      1,
      -32
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      44
     ],
     [
      0.5,
      32
     ],
     [
      1,
      44
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-03"
 },
 "sink": {
  "id": "sink",
  "name": "Sink down (fade out)",
  "words": [
   "sink",
   "go down",
   "down",
   "disappear",
   "fade",
   "gone"
  ],
  "tags": [
   "move",
   "piece",
   "aac"
  ],
  "target": "piece",
  "duration": 2400,
  "loop": false,
  "still": 0.5,
  "tracks": {
   "root": {
    "y": [
     [
      0,
      0
     ],
     [
      0.5,
      38
     ],
     [
      1,
      90
     ]
    ],
    "opacity": [
     [
      0,
      1
     ],
     [
      0.15,
      1
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-03"
 },
 "some": {
  "id": "some",
  "name": "Some (a small scoop)",
  "words": [
   "some",
   "a little",
   "a bit",
   "a few",
   "part",
   "portion"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.6,
  "face": "neutral",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      -14
     ],
     [
      0.3,
      -26
     ],
     [
      0.6,
      -22
     ],
     [
      0.8,
      -14
     ],
     [
      1,
      -14
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      10
     ],
     [
      0.3,
      18
     ],
     [
      0.6,
      72
     ],
     [
      0.8,
      30
     ],
     [
      1,
      10
     ]
    ]
   },
   "wristR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      -12
     ],
     [
      0.6,
      14
     ],
     [
      0.8,
      4
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "faceY": [
     [
      0,
      0
     ],
     [
      0.3,
      2
     ],
     [
      0.6,
      4
     ],
     [
      0.85,
      0
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "swayTree": {
  "id": "swayTree",
  "name": "Sway (tree, flag)",
  "words": [
   "sway",
   "tree",
   "wind",
   "windy",
   "breeze",
   "flag",
   "gentle",
   "calm"
  ],
  "tags": [
   "move",
   "piece",
   "ambient",
   "loop"
  ],
  "target": "piece",
  "duration": 2000,
  "loop": true,
  "still": 0.5,
  "tracks": {
   "root": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.125,
      2.1
     ],
     [
      0.25,
      3
     ],
     [
      0.375,
      2.1
     ],
     [
      0.5,
      0
     ],
     [
      0.625,
      -2.1
     ],
     [
      0.75,
      -3
     ],
     [
      0.875,
      -2.1
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "talk": {
  "id": "talk",
  "name": "Talk",
  "words": [
   "talk",
   "say",
   "speak",
   "tell",
   "chat",
   "words"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.25,
  "face": "talk",
  "tracks": {
   "neck": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -2
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      2
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.25,
      3
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      3
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      20
     ],
     [
      0.45,
      16
     ],
     [
      0.65,
      22
     ],
     [
      0.85,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      10
     ],
     [
      0.45,
      5
     ],
     [
      0.65,
      12
     ],
     [
      0.85,
      0
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "treatPail": {
  "id": "treatPail",
  "name": "Treat pail (holding it out)",
  "words": [
   "treat",
   "treats",
   "pail",
   "bucket",
   "candy",
   "snack",
   "offer",
   "give",
   "trick or treat",
   "would you like one"
  ],
  "tags": [
   "aac",
   "gesture",
   "offer",
   "prop"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.5,
  "face": "happy",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      -44
     ],
     [
      0.5,
      -52
     ],
     [
      1,
      -44
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.5,
      -6
     ],
     [
      1,
      0
     ]
    ]
   },
   "wristR": {
    "rot": [
     [
      0,
      44
     ],
     [
      0.5,
      52
     ],
     [
      1,
      44
     ]
    ]
   },
   "neck": {
    "y": [
     [
      0,
      0
     ],
     [
      0.5,
      1
     ],
     [
      1,
      0
     ]
    ],
    "faceY": [
     [
      0,
      0
     ],
     [
      0.5,
      2
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "props": {
   "wristR": "pail"
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "turn": {
  "id": "turn",
  "name": "Turn (knob or page)",
  "words": [
   "turn",
   "turn the page",
   "page",
   "knob",
   "twist",
   "rotate",
   "next page",
   "open"
  ],
  "tags": [
   "aac",
   "gesture",
   "action"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0.5,
  "face": "neutral",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      -35
     ],
     [
      1,
      -35
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      -62
     ],
     [
      0.45,
      -70
     ],
     [
      0.55,
      -70
     ],
     [
      0.95,
      -62
     ],
     [
      1,
      -62
     ]
    ]
   },
   "wristR": {
    "rot": [
     [
      0,
      -10
     ],
     [
      0.45,
      28
     ],
     [
      0.55,
      28
     ],
     [
      0.95,
      -10
     ],
     [
      1,
      -10
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "turnAround": {
  "id": "turnAround",
  "name": "Turn away and back",
  "words": [
   "turn around",
   "turn away",
   "look away",
   "look back",
   "over there",
   "not now"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 2000,
  "loop": false,
  "still": 0.5,
  "face": "neutral",
  "tracks": {
   "neck": {
    "faceX": [
     [
      0,
      0
     ],
     [
      0.2,
      -6
     ],
     [
      0.35,
      -10
     ],
     [
      0.65,
      -10
     ],
     [
      0.8,
      -6
     ],
     [
      1,
      0
     ]
    ],
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      -3
     ],
     [
      0.35,
      -6
     ],
     [
      0.65,
      -6
     ],
     [
      0.8,
      -3
     ],
     [
      1,
      0
     ]
    ]
   },
   "waist": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.2,
      -2
     ],
     [
      0.35,
      -4
     ],
     [
      0.65,
      -4
     ],
     [
      0.8,
      -2
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-03"
 },
 "walkSlow": {
  "id": "walkSlow",
  "name": "Walk slowly (in place)",
  "words": [
   "walk slowly",
   "slow",
   "stroll",
   "walk",
   "go slowly",
   "calm"
  ],
  "tags": [
   "aac",
   "move",
   "cycle",
   "calm"
  ],
  "target": "body",
  "duration": 1800,
  "loop": true,
  "still": 0,
  "face": "neutral",
  "tracks": {
   "root": {
    "y": [
     [
      0,
      0
     ],
     [
      0.25,
      -3
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -3
     ],
     [
      1,
      0
     ]
    ]
   },
   "waist": {
    "rot": [
     [
      0,
      2
     ],
     [
      0.5,
      -2
     ],
     [
      1,
      2
     ]
    ]
   },
   "hipL": {
    "rot": [
     [
      0,
      9
     ],
     [
      0.25,
      0
     ],
     [
      0.5,
      -9
     ],
     [
      0.75,
      0
     ],
     [
      1,
      9
     ]
    ]
   },
   "hipR": {
    "rot": [
     [
      0,
      -9
     ],
     [
      0.25,
      0
     ],
     [
      0.5,
      9
     ],
     [
      0.75,
      0
     ],
     [
      1,
      -9
     ]
    ]
   },
   "kneeL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      12
     ],
     [
      0.5,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "kneeR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      12
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderL": {
    "rot": [
     [
      0,
      -8
     ],
     [
      0.25,
      0
     ],
     [
      0.5,
      8
     ],
     [
      0.75,
      0
     ],
     [
      1,
      -8
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      8
     ],
     [
      0.25,
      0
     ],
     [
      0.5,
      -8
     ],
     [
      0.75,
      0
     ],
     [
      1,
      8
     ]
    ]
   },
   "tail": {
    "rot": [
     [
      0,
      -4
     ],
     [
      0.5,
      4
     ],
     [
      1,
      -4
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-03"
 },
 "waveBoth": {
  "id": "waveBoth",
  "name": "Wave with both hands",
  "words": [
   "hello",
   "hi",
   "bye",
   "goodbye",
   "over here",
   "look at me"
  ],
  "tags": [
   "aac",
   "emote",
   "gesture"
  ],
  "target": "body",
  "duration": 1200,
  "loop": true,
  "still": 0.25,
  "face": "happy",
  "pose": "wave",
  "tracks": {
   "shoulderL": {
    "rot": [
     [
      0,
      151
     ],
     [
      1,
      151
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      24
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      24
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -24
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -24
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-02; kept by Design 2026-11-03"
 },
 "witchHat": {
  "id": "witchHat",
  "name": "Witch hat (hands on head)",
  "words": [
   "witch",
   "hat",
   "witch hat",
   "pointy hat",
   "costume",
   "dress up",
   "Halloween",
   "pretend"
  ],
  "tags": [
   "emote",
   "gesture",
   "play",
   "costume"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.5,
  "face": "happy",
  "tracks": {
   "shoulderL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      140
     ],
     [
      0.7,
      140
     ],
     [
      0.85,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      -140
     ],
     [
      0.7,
      -140
     ],
     [
      0.85,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      75
     ],
     [
      0.5,
      78
     ],
     [
      0.7,
      75
     ],
     [
      0.85,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      -75
     ],
     [
      0.5,
      -78
     ],
     [
      0.7,
      -75
     ],
     [
      0.85,
      0
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "faceY": [
     [
      0,
      0
     ],
     [
      0.3,
      2
     ],
     [
      0.7,
      2
     ],
     [
      0.85,
      0
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drafted by chat via the API, 2026-11-03; kept by Design 2026-11-03"
 },
 "painWince": {
  "id": "painWince",
  "name": "Pain (hand to body, wince)",
  "words": [
   "pain",
   "hurt",
   "sore"
  ],
  "tags": [
   "aac",
   "care",
   "emote"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.35,
  "face": "frown",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.35,
      4
     ],
     [
      1,
      0
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      95
     ],
     [
      0.35,
      105
     ],
     [
      0.7,
      98
     ],
     [
      1,
      95
     ]
    ]
   },
   "waist": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.35,
      -3
     ],
     [
      0.7,
      -1
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "faceY": [
     [
      0,
      0
     ],
     [
      0.35,
      3
     ],
     [
      1,
      0
     ]
    ],
    "rot": [
     [
      0,
      0
     ],
     [
      0.35,
      -3
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drawn by Design 2026-11-03 (Mike: care words act by default)"
 },
 "hotFan": {
  "id": "hotFan",
  "name": "Hot (fanning the face)",
  "words": [
   "hot",
   "warm"
  ],
  "tags": [
   "aac",
   "care",
   "emote"
  ],
  "target": "body",
  "duration": 1600,
  "loop": true,
  "still": 0.25,
  "face": "frown",
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      -10
     ],
     [
      1,
      -10
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      135
     ],
     [
      0.25,
      150
     ],
     [
      0.5,
      135
     ],
     [
      0.75,
      150
     ],
     [
      1,
      135
     ]
    ]
   },
   "wristR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.25,
      -20
     ],
     [
      0.5,
      0
     ],
     [
      0.75,
      -20
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drawn by Design 2026-11-03 (Mike: care words act by default)"
 },
 "coldShiver": {
  "id": "coldShiver",
  "name": "Cold (arms hugged, a small shiver)",
  "words": [
   "cold",
   "chilly"
  ],
  "tags": [
   "aac",
   "care",
   "emote"
  ],
  "target": "body",
  "duration": 1600,
  "loop": true,
  "still": 0.25,
  "face": "frown",
  "tracks": {
   "shoulderL": {
    "rot": [
     [
      0,
      -8
     ],
     [
      1,
      -8
     ]
    ]
   },
   "elbowL": {
    "rot": [
     [
      0,
      -105
     ],
     [
      1,
      -105
     ]
    ]
   },
   "shoulderR": {
    "rot": [
     [
      0,
      8
     ],
     [
      1,
      8
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      105
     ],
     [
      1,
      105
     ]
    ]
   },
   "root": {
    "x": [
     [
      0,
      0
     ],
     [
      0.125,
      1.5
     ],
     [
      0.25,
      0
     ],
     [
      0.375,
      -1.5
     ],
     [
      0.5,
      0
     ],
     [
      0.625,
      1.5
     ],
     [
      0.75,
      0
     ],
     [
      0.875,
      -1.5
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "y": [
     [
      0,
      2
     ],
     [
      1,
      2
     ]
    ]
   }
  },
  "source": "drawn by Design 2026-11-03 (Mike: care words act by default)"
 },
 "askCare": {
  "id": "askCare",
  "name": "Asking for care (hand up, looking over)",
  "words": [
   "bedpan",
   "suction",
   "change",
   "toilet",
   "need"
  ],
  "tags": [
   "aac",
   "care",
   "gesture"
  ],
  "target": "body",
  "duration": 2000,
  "loop": true,
  "still": 0.5,
  "tracks": {
   "shoulderR": {
    "rot": [
     [
      0,
      -6
     ],
     [
      0.3,
      -120
     ],
     [
      0.8,
      -120
     ],
     [
      1,
      -6
     ]
    ]
   },
   "elbowR": {
    "rot": [
     [
      0,
      0
     ],
     [
      0.3,
      -20
     ],
     [
      0.8,
      -20
     ],
     [
      1,
      0
     ]
    ]
   },
   "neck": {
    "faceX": [
     [
      0,
      0
     ],
     [
      0.3,
      -6
     ],
     [
      0.8,
      -6
     ],
     [
      1,
      0
     ]
    ]
   }
  },
  "source": "drawn by Design 2026-11-03 (Mike: care words act by default)"
 }
};
