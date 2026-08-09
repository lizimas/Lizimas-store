-- =====================================================================
-- Lizimas Store — migration 018
-- Seed Uganda administrative hierarchy, levels 1-5
--
-- Source: UBOS, National Population and Housing Census 2024,
--         Subcounty Profiles (Table 1). Population = 2024 census total.
--
-- Levels seeded here:
--   1 Region      (4)
--   2 District    (147, includes the 10 city authorities + KCCA)
--   3 County / Municipality / City Division   (312)
--   4 Sub-county / Division / Town Council    (2,207)
--   5 Parish / Ward                           (10,854)
--
-- Level 6 (Village / Cell) is NOT in this file. UBOS does not publish it.
-- It is grown from customer entries via the checkout combobox.
--
-- Safe to re-run: every insert is ON CONFLICT DO NOTHING.
--
-- Run:  psql "$RENDER_DB" -f 018_seed_uganda_locations.sql
-- =====================================================================

BEGIN;

SET LOCAL client_min_messages TO WARNING;

-- ---------------------------------------------------------------------
-- Columns added since 016
-- ---------------------------------------------------------------------
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS district_id INTEGER REFERENCES locations(id),
  ADD COLUMN IF NOT EXISTS population  INTEGER;

CREATE INDEX IF NOT EXISTS locations_district_idx ON locations (district_id, level)
  WHERE is_active;

-- ---------------------------------------------------------------------
-- Corrected fill trigger (replaces the version shipped in 016 — the
-- grandparent lookup in that one was wrong). Maintains name_norm, path,
-- district_id and a human label such as 'Luzira, Nakawa Division, Kampala'.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION locations_fill() RETURNS TRIGGER AS $fn$
DECLARE
  p      RECORD;
  d_name TEXT;
  parts  TEXT[];
BEGIN
  NEW.name      := btrim(regexp_replace(NEW.name, '\s+', ' ', 'g'));
  NEW.name_norm := lower(unaccent(NEW.name));

  IF NEW.parent_id IS NULL THEN
    IF NEW.level <> 1 THEN
      RAISE EXCEPTION 'locations: only level 1 (region) may have no parent';
    END IF;
    NEW.path        := '/';
    NEW.district_id := NULL;
    NEW.label       := NEW.name;
  ELSE
    SELECT id, path, name, level, district_id
      INTO p
      FROM locations
     WHERE id = NEW.parent_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'locations: parent % does not exist', NEW.parent_id;
    END IF;
    IF p.level <> NEW.level - 1 THEN
      RAISE EXCEPTION 'locations: a level-% row cannot sit under a level-% row',
        NEW.level, p.level;
    END IF;

    NEW.path        := p.path || p.id || '/';
    NEW.district_id := CASE WHEN NEW.level = 2
                            THEN NULL
                            ELSE COALESCE(p.district_id, p.id) END;

    parts := ARRAY[NEW.name];
    IF NEW.level >= 4 AND p.name <> NEW.name THEN
      parts := parts || p.name;
    END IF;
    IF NEW.district_id IS NOT NULL THEN
      SELECT name INTO d_name FROM locations WHERE id = NEW.district_id;
      IF d_name IS NOT NULL AND NOT (d_name = ANY (parts)) THEN
        parts := parts || d_name;
      END IF;
    END IF;
    NEW.label := array_to_string(parts, ', ');
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS locations_fill_trg ON locations;
CREATE TRIGGER locations_fill_trg
  BEFORE INSERT OR UPDATE OF name, parent_id ON locations
  FOR EACH ROW EXECUTE FUNCTION locations_fill();

-- A district is its own district.
CREATE OR REPLACE FUNCTION locations_self_district() RETURNS TRIGGER AS $fn$
BEGIN
  UPDATE locations SET district_id = NEW.id WHERE id = NEW.id AND district_id IS NULL;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS locations_self_district_trg ON locations;
CREATE TRIGGER locations_self_district_trg
  AFTER INSERT ON locations
  FOR EACH ROW WHEN (NEW.level = 2)
  EXECUTE FUNCTION locations_self_district();

-- ---------------------------------------------------------------------
-- Staging
-- ---------------------------------------------------------------------
CREATE TEMP TABLE _stage (
  tmp_id     INTEGER PRIMARY KEY,
  tmp_parent INTEGER,
  lvl        SMALLINT NOT NULL,
  name       TEXT     NOT NULL,
  pop        INTEGER
) ON COMMIT DROP;

COPY _stage (tmp_id, tmp_parent, lvl, name, pop) FROM stdin;
1	\N	1	Central	\N
2	\N	1	Eastern	\N
3	\N	1	Northern	\N
4	\N	1	Western	\N
5	3	2	Abim	144084
6	5	3	Labwor County	144084
7	6	4	Abim	8954
8	7	5	Abongepach	986
9	7	5	Adwal	1308
10	7	5	Aninata	2104
11	7	5	Arembwola	1114
12	7	5	Kanu	2026
13	7	5	Oima	1416
14	6	4	Abim Town Council	8636
15	14	5	Agwata Ward	1868
16	14	5	Angwee Ward	2813
17	14	5	Oringowelo Ward	1978
18	14	5	Wiawer Ward	1977
19	6	4	Abuk Town Council	4137
20	19	5	Abuk Ward	478
21	19	5	Arengetithoe Ward	513
22	19	5	Awokolem Ward	479
23	19	5	Cemee Ward	1071
24	19	5	District Quarters Ward	578
25	19	5	Oree Ward	1018
26	6	4	Alerek	5454
27	26	5	Kathimongor	942
28	26	5	Kulodwong	1312
29	26	5	Loyoroit	1483
30	26	5	Ocom	255
31	26	5	Olem	1462
32	6	4	Alerek Town Council	6168
33	32	5	Kawang Ward	1760
34	32	5	Otumpili Ward	3718
35	32	5	University Ward	690
36	6	4	Atunga	6384
37	36	5	Apok	566
38	36	5	Atunga	1470
39	36	5	Oryeotyene	2273
40	36	5	Otalabar	2075
41	6	4	Awach	15834
42	41	5	Awach	3301
43	41	5	Barlyech	2359
44	41	5	Gotapwou	3441
45	41	5	Oporoth	6733
46	6	4	Camkok	3109
47	46	5	Angorom	708
48	46	5	Kothidany	509
49	46	5	Okililing	1892
50	6	4	Kiru Town Council	8121
51	50	5	Kalakala Ward	2697
52	50	5	Kiru Ward	1786
53	50	5	Oyaro Ward	3638
54	6	4	Lotukei	12032
55	54	5	Aojapiro	2449
56	54	5	Aridai	1578
57	54	5	Gangming	2647
58	54	5	Gulopono	2119
59	54	5	Loka	1983
60	54	5	Yarayara	1256
61	6	4	Magamaga	7826
62	61	5	Gulotworo	1418
63	61	5	Koya	2213
64	61	5	Monyanga	2314
65	61	5	Wilela	1881
66	6	4	Morulem	11307
67	66	5	Adea	6343
68	66	5	Akwangagwel	1946
69	66	5	Katabok West	3018
70	6	4	Morulem Town Council	16637
71	70	5	Achwaa Ward	1785
72	70	5	Angolebwal East	1134
73	70	5	Angolebwal West	1225
74	70	5	Aremo Ward	1970
75	70	5	Arengepua Ward	969
76	70	5	Golonger Ward	1574
77	70	5	Katabok East Ward	2259
78	70	5	Lobolwala Ward	2949
79	70	5	Obolokome Ward	1796
80	70	5	Ruka Ward	976
81	6	4	Nyakwae	15162
82	81	5	Kathebakume	781
83	81	5	Kobulin	4389
84	81	5	Okimia	1162
85	81	5	Oretha	3068
86	81	5	Pupukamuya	2964
87	81	5	Rogom	2798
88	6	4	Opopongo	5156
89	88	5	Katala	890
90	88	5	Kopua	1091
91	88	5	Nuthu	1563
92	88	5	Opopongo	1612
93	6	4	Orwamuge Town Council	9167
94	93	5	Achangali Ward	2016
95	93	5	Aridai Ward	793
96	93	5	Bartanga Ward	2224
97	93	5	Kakweth Ward	2064
98	93	5	Orwamuge Ward	2070
99	3	2	Adjumani	297894
100	99	3	Adjumani East County	178808
101	100	4	Arinyapi	10164
102	101	5	Arasi	1626
103	101	5	Elegu	1828
104	101	5	Ituji	2272
105	101	5	Liri	2998
106	101	5	Zinyini	1440
107	100	4	Dzaipi	20189
108	107	5	Adidi	3299
109	107	5	Ajugopi	5697
110	107	5	Logoangwa	3982
111	107	5	Mgbere	2963
112	107	5	Miniki	4248
113	100	4	Itirikwa	18457
114	113	5	Baratuku	2520
115	113	5	Itirikwa	1916
116	113	5	Kolididi	2692
117	113	5	Mungula	3789
118	113	5	Odu	3455
119	113	5	Zoka	4085
120	100	4	Ofua	14835
121	120	5	Bacere	2542
122	120	5	Ilinyi	2975
123	120	5	Ofua Central	3569
124	120	5	Opi	1932
125	120	5	Subbe	1906
126	120	5	Tianyu	1911
127	100	4	Pakele	15467
128	127	5	Boroli	3749
129	127	5	Fuda	2487
130	127	5	Ibibiaworo	1155
131	127	5	Lewa	2187
132	127	5	Meliaderi	1813
133	127	5	Melijo	2286
134	127	5	Pereci	1790
135	100	4	Pakele Town Council	15347
136	135	5	Ataboo Ward	3984
137	135	5	Central Ward	4994
138	135	5	Nyivura Ward	3244
139	135	5	Pereci Ward	3125
140	100	4	Refugee Settlement Camps	84349
141	140	5	Ayilo 1 Settlement	15222
142	140	5	Ayilo 2 Settlement	8422
143	140	5	Baratuku Settlement	3192
144	140	5	Boroli Settlement	3516
145	140	5	Elema Settlement	583
146	140	5	Mirieyi Settlement	1911
147	140	5	Mungula 1 Settlement	4135
148	140	5	Mungula 2 Settlement	1184
149	140	5	Nyumanzi Settlement	24281
150	140	5	Olua 1 Settlement	1988
151	140	5	Olua 2 Settlement	1409
152	140	5	Pagirinya Settlement	18506
153	99	3	Adjumani West County	119086
154	153	4	Adjumani Town Council	36853
155	154	5	Biyaya Ward	11465
156	154	5	Central Ward	11449
157	154	5	Cesia Ward	13939
158	153	4	Adropi	9089
159	158	5	Esia	2828
160	158	5	Lajopi	31
161	158	5	Obilokong	2132
162	158	5	Openzinzi	1430
163	158	5	Palemo	2668
164	153	4	Ciforo	16872
165	164	5	Agojo	4126
166	164	5	Loa	3154
167	164	5	Mugi	2397
168	164	5	Okangali	4559
169	164	5	Opejo	2636
170	153	4	Pachara	14068
171	170	5	Alere	2314
172	170	5	Jihwa	1978
173	170	5	Marindi	5117
174	170	5	Omi	1664
175	170	5	Unna	2995
176	153	4	Refugee Settlement Camps	28219
177	176	5	Agojo Settlement	2898
178	176	5	Alere	2790
179	176	5	Maaji 1 Settlement	842
180	176	5	Maaji 2 Settlement	11167
181	176	5	Maaji 3 Settlement	8188
182	176	5	Oliji	2334
183	153	4	Ukusijoni	13985
184	183	5	Ayiri	4997
185	183	5	Gulinya	1836
186	183	5	Kiraba	1983
187	183	5	Maaji	3175
188	183	5	Payaru	1994
189	3	2	Agago	307235
190	189	3	Agago County	102720
191	190	4	Adilang	11241
192	191	5	Kulaka	934
193	191	5	Labwa	3922
194	191	5	Lapyem	3084
195	191	5	Nam	3301
196	190	4	Adilang Town Council	6212
197	196	5	Adilang Central Ward	1685
198	196	5	Alaa Ward	1481
199	196	5	Lalal Ward	1392
200	196	5	Lumule Ward	1654
201	190	4	Agago Town Council	7946
202	201	5	Agago Central Ward	1963
203	201	5	Ajali Ward	1841
204	201	5	Ngora Ward	2789
205	201	5	Pampara Ward	1353
206	190	4	Ajali	7232
207	206	5	Ajali Atede	1144
208	206	5	Kiteny	1381
209	206	5	Ladere	926
210	206	5	Lajwa	1865
211	206	5	Otumpili	1916
212	190	4	Kotomor	14891
213	212	5	Apobo	2456
214	212	5	Lukee	3184
215	212	5	Ogong	2086
216	212	5	Olyelo Widyel	2300
217	212	5	Omatowee	2926
218	212	5	Otek	1939
219	190	4	Laperebong	13730
220	219	5	Ligiligi	3263
221	219	5	Nanangwe	2821
222	219	5	Ngekidi	4547
223	219	5	Orina	3099
224	190	4	Lokole	15088
225	224	5	Aywee	2654
226	224	5	Kiwaro	2590
227	224	5	Luzira	2412
228	224	5	Ngudi	1625
229	224	5	Ngwero	2899
230	224	5	Olung	1997
231	224	5	Wiidwol	911
232	190	4	Patongo	13776
233	232	5	Kal	2764
234	232	5	Lakwa	2369
235	232	5	Lukwangole	4471
236	232	5	Odongkiwinyo	4172
237	190	4	Patongo Town Council	12604
238	237	5	Akomo Ward	1436
239	237	5	Forest Ward	2390
240	237	5	Oporot Ward	4478
241	237	5	Pece Ward	4300
242	189	3	Agago North County	141130
243	242	4	Kalongo Town Council	15247
244	243	5	Akado Ward	4002
245	243	5	Alupere Ward	2260
246	243	5	Kubwor Ward	1954
247	243	5	Oret Ward	3021
248	243	5	Town Ward	4010
249	242	4	Kuywee	15456
250	249	5	Atut	3294
251	249	5	Bombo	2691
252	249	5	Kal-Agum	2360
253	249	5	Labwordwong	1875
254	249	5	Lamit	2013
255	249	5	Paluti	3223
256	242	4	Lai-Mutto Town Council	10929
257	256	5	Akwang Ward	2518
258	256	5	Lai Ward	3595
259	256	5	Mutto Ward	2586
260	256	5	Wipolo Ward	2230
261	242	4	Lapono	16040
262	261	5	Amyel	5283
263	261	5	Kaket	5403
264	261	5	Ogole	3777
265	261	5	Ongalo	1577
266	242	4	Lira Kato	14565
267	266	5	Abilonino	2119
268	266	5	Biwang	3446
269	266	5	Lapono-Muk	3906
270	266	5	Lira-Kato	5094
271	242	4	Omiya Pacwa	16167
272	271	5	Laita	4687
273	271	5	Lakwa	4108
274	271	5	Lojim	3467
275	271	5	Lomoi	3905
276	242	4	Paimol	14287
277	276	5	Mutto	3328
278	276	5	Ngora	3349
279	276	5	Pacabol	6002
280	276	5	Taa	1608
281	242	4	Parabongo	16884
282	281	5	Pabala	5692
283	281	5	Pacer	6037
284	281	5	Pakor	3487
285	281	5	Parumu	1668
286	242	4	Wol	15165
287	286	5	Kimiya	2907
288	286	5	Lokabar	2009
289	286	5	Lugung	1604
290	286	5	Mura	2357
291	286	5	Ogole	3128
292	286	5	Rogo	3160
293	242	4	Wol Town Council	6390
294	293	5	Guda Ward	2285
295	293	5	Kico Ward	1791
296	293	5	Lubanya Ward	1214
297	293	5	Panyagol Ward	1100
298	189	3	Agago West County	63385
299	298	4	Agengo	12210
300	299	5	Ademi	3161
301	299	5	Agengo	1310
302	299	5	Alwee	3385
303	299	5	Laguti	1471
304	299	5	Lutome	1641
305	299	5	Tori	1242
306	298	4	Arum	13926
307	306	5	Achol-Pii	3957
308	306	5	Agelec	3278
309	306	5	Alela	2808
310	306	5	Kazikazi	3883
311	298	4	Geregere	8755
312	311	5	Baradanga	2575
313	311	5	Latinling	1559
314	311	5	Olupe	2214
315	311	5	Tenge	2407
316	298	4	Lamiyo	11003
317	316	5	Ojur	2872
318	316	5	Otaka	2900
319	316	5	Paicam	2663
320	316	5	Polcani	2568
321	298	4	Lira-Palwo	6711
322	321	5	Biwang	1433
323	321	5	Lanyirinyiri	2189
324	321	5	Lapeta	1291
325	321	5	Omongo	1798
326	298	4	Lira-Palwo Town Council	3356
327	326	5	Abone Gang Kal Ward	980
328	326	5	Bulotwomo Ward	543
329	326	5	Lapilyet Ward	1041
330	326	5	Pyergweng Ward	792
331	298	4	Omot	7424
332	331	5	Atece	1697
333	331	5	Awonodwe	1996
334	331	5	Barima	1693
335	331	5	Opari	2038
336	3	2	Alebtong	283509
337	336	3	Ajuri County	155835
338	337	4	Abako	36689
339	338	5	Alanyi	6590
340	338	5	Amononeno	7740
341	338	5	Angoltok	5244
342	338	5	Anyiti	6490
343	338	5	Awapiny	5167
344	338	5	Awori	5458
345	337	4	Adwir	18101
346	345	5	Adwir	2753
347	345	5	Alolololo	4282
348	345	5	Ocokober	2938
349	345	5	Okomo	4486
350	345	5	Olwero	3642
351	337	4	Amugu	22028
352	351	5	Abongoatin	7465
353	351	5	Abunga	6876
354	351	5	Omee	7687
355	337	4	Amugu Town Council	10772
356	355	5	Acek Ward	2240
357	355	5	Ajonyi Ward	2934
358	355	5	Okum Ward	2431
359	355	5	Opayeng Ward	3167
360	337	4	Angetta	15254
361	360	5	Angetta	3423
362	360	5	Atelelo	2203
363	360	5	Aweingo	3701
364	360	5	Obuo	3018
365	360	5	Okurango	2909
366	337	4	Awei	29052
367	366	5	Acede	8815
368	366	5	Ojul	7151
369	366	5	Olyet	5738
370	366	5	Owalo	7348
371	337	4	Omoro	23939
372	371	5	Abukamola	5642
373	371	5	Baropiro	4815
374	371	5	Baya	4757
375	371	5	Oculokori	5117
376	371	5	Omarari	3608
377	336	3	Moroto County	127674
378	377	4	Abia	27623
379	378	5	Abangoimany	5286
380	378	5	Aberidwogo	4818
381	378	5	Abia	4165
382	378	5	Atinkok	4654
383	378	5	Oteno	4196
384	378	5	Tekulu	4504
385	377	4	Akura	26399
386	385	5	Akura	6118
387	385	5	Anyanga	2288
388	385	5	Anyanga B	2303
389	385	5	Bardago	4688
390	385	5	Kai	6141
391	385	5	Otweotoke	4861
392	377	4	Alebtong Town Council	9279
393	392	5	Alyec Ward	3562
394	392	5	Apado Ward	2367
395	392	5	Nakabela Ward	3350
396	377	4	Aloi	19653
397	396	5	Akwangkel	3658
398	396	5	Alebtong	4738
399	396	5	Amuria	4887
400	396	5	Anara	6370
401	377	4	Aloi Town Council	20426
402	401	5	Alal Ward	5597
403	401	5	Anino Ward	4640
404	401	5	Awiepek Ward	2970
405	401	5	Imakioboro Ward	2678
406	401	5	Okoto Ward	1852
407	401	5	Te-Iconga Ward	2689
408	377	4	Apala	16898
409	408	5	Abiiting	1527
410	408	5	Amonomito	2786
411	408	5	Obim	6065
412	408	5	Okwangole	2591
413	408	5	Olaoilongo	3929
414	377	4	Apala Town Council	7396
415	414	5	Abongo Awobe Ward	865
416	414	5	Abongodyang Ward	1185
417	414	5	Apanyapany Ward	1674
418	414	5	Bediworo Ward	1426
419	414	5	Central Ward	827
420	414	5	Cungaciki Ward	707
421	414	5	Elupe Ward	712
422	3	2	Amolatar	188715
423	422	3	Kioga County	90760
424	423	4	Acii	9809
425	424	5	Acii	1336
426	424	5	Alwala	1816
427	424	5	Awikori	1945
428	424	5	Kongoro	2444
429	424	5	Muchora	1377
430	424	5	Otike	891
431	423	4	Agwingiri	10310
432	431	5	Acotedo	878
433	431	5	Agwingiri	1139
434	431	5	Alemere	1436
435	431	5	Alemere West	1441
436	431	5	Alyecmeda	2424
437	431	5	Anywal Wake	1423
438	431	5	Namiza	1569
439	423	4	Amolatar Town Council	14930
440	439	5	Aburkot Ward	2933
441	439	5	Amirimiri Ward	3037
442	439	5	Apale Pe Ward	2564
443	439	5	Epyel Ward	2143
444	439	5	Inomo Ward	4253
445	423	4	Muntu	18264
446	445	5	Abarler	4103
447	445	5	Kabangala	3566
448	445	5	Muntu	3058
449	445	5	Nakatiti	3838
450	445	5	Odiak	3699
451	423	4	Nalubwoyo	10633
452	451	5	Agwenonywal	1666
453	451	5	Alwala	2575
454	451	5	Amolatar	2030
455	451	5	Nalubwoyo	2872
456	451	5	Ocamolum	1490
457	423	4	Namasale	16523
458	457	5	Adagani	923
459	457	5	Aguludia	2027
460	457	5	Bangladesh	2265
461	457	5	Burakwana	2399
462	457	5	Gozwe	1815
463	457	5	Izigwe	1177
464	457	5	Kikondo	1339
465	457	5	Nabweyo	2056
466	457	5	Olyaka	2522
467	423	4	Namasale Town Council	10291
468	467	5	Aweipeko Ward	2658
469	467	5	Central Ward	3234
470	467	5	Kayago Ward	2257
471	467	5	Wabinua Ward	2142
472	422	3	Kioga North County	97955
473	472	4	Abeja	10124
474	473	5	Abeja	3474
475	473	5	Akol	2273
476	473	5	Aringo Ceng	1017
477	473	5	Lubiri	1332
478	473	5	Otangocinge	2028
479	472	4	Agikdak	14325
480	479	5	Abarikori	2796
481	479	5	Agikdak	4185
482	479	5	Alobo-Okwe	4504
483	479	5	Awonangiro	2840
484	472	4	Akwon	9274
485	484	5	Abalodyang	3514
486	484	5	Akwon	2099
487	484	5	Aromi	2287
488	484	5	Okiji	1374
489	472	4	Aputi	9146
490	489	5	Alyet	1823
491	489	5	Amai	2112
492	489	5	Anywali	2108
493	489	5	Awinyipany	1648
494	489	5	Oboto Moo	1455
495	472	4	Arwotcek	11193
496	495	5	Aburkidi	1968
497	495	5	Abwong	1596
498	495	5	Arwotcek	2025
499	495	5	Awac	1498
500	495	5	Ayamawele	1341
501	495	5	Ogenga	1122
502	495	5	Ojem	1643
503	472	4	Awello	14422
504	503	5	Akongomit	3478
505	503	5	Anamwany	2386
506	503	5	Atero	3547
507	503	5	Atomoro	2041
508	503	5	Odyedo	2970
509	472	4	Etam	9350
510	509	5	Abwockwar	3363
511	509	5	Anamido	2696
512	509	5	Awiodyek	3291
513	472	4	Etam Town Council	10148
514	513	5	Adum Ward	1442
515	513	5	Alaro Ward	1878
516	513	5	Arwot Ward	2447
517	513	5	Chakwara Ward	2075
518	513	5	Etam Ward	2306
519	472	4	Opali	9973
520	519	5	Acan Oryema	1518
521	519	5	Adonyimo	1988
522	519	5	Agweng	1410
523	519	5	Akuriluba	1693
524	519	5	Opali	1680
525	519	5	Otira	1684
526	3	2	Amudat	203358
527	526	3	Upe County	203358
528	527	4	Abiliyep	27670
529	528	5	Abiliyep	6934
530	528	5	Akorikeya	6462
531	528	5	Lopedot	6562
532	528	5	Loyep	7712
533	527	4	Achorichor	8600
534	533	5	Achorichor	1415
535	533	5	Iwakai	5014
536	533	5	Lomerai	2171
537	527	4	Amudat	36096
538	537	5	Alakas	10831
539	537	5	Amudat	3217
540	537	5	Chepongos	6035
541	537	5	Loburin	3407
542	537	5	Nabokotom	6252
543	537	5	Naremit	2140
544	537	5	Ngongosowon	4214
545	527	4	Amudat Town Council	16081
546	545	5	Jumbe Ward	3537
547	545	5	Kalas Ward	4242
548	545	5	Lochengenge Ward	3812
549	545	5	Tingas Ward	4490
550	527	4	Karita	16356
551	550	5	Abongai	6725
552	550	5	Karita	4008
553	550	5	Naporokocha	5623
554	527	4	Karita Town Council	18082
555	554	5	Arol Ward	2478
556	554	5	Chemoning A Ward	1575
557	554	5	Lomeuta B Ward	3664
558	554	5	Moruongor Ward	2480
559	554	5	Senior Quarters Ward	3948
560	554	5	Taparak Ward	3937
561	527	4	Katabok	19536
562	561	5	Dingdinga	5231
563	561	5	Kapetawoi	6683
564	561	5	Katabok	4389
565	561	5	Motany	3233
566	527	4	Kongorok	11828
567	566	5	Anguruma	4968
568	566	5	Kongorok	6860
569	527	4	Lokales	15626
570	569	5	Arukanes	4074
571	569	5	Chepkararat	4771
572	569	5	Lokales	5675
573	569	5	Moruakruk	1106
574	527	4	Loroo	17800
575	574	5	Loborokocha	6472
576	574	5	Loroo	9382
577	574	5	Namosing	1946
578	527	4	Losidok	15683
579	578	5	Cheptapoyo	4973
580	578	5	Lokoma	3230
581	578	5	Losidok	7480
582	2	2	Amuria	251653
583	582	3	Amuria County	166650
584	583	4	Abarilela	31426
585	584	5	Arute	4868
586	584	5	Asilang	4451
587	584	5	Dodos	3949
588	584	5	Katine	8380
589	584	5	Ocal	5122
590	584	5	Olelai	4656
591	583	4	Abia	10482
592	591	5	Abia	1735
593	591	5	Agwara	2821
594	591	5	Akular	1325
595	591	5	Odongai	2495
596	591	5	Ogudo	2106
597	583	4	Amolo	11886
598	597	5	Ajokomot	940
599	597	5	Amolo	1138
600	597	5	Amukurat	2114
601	597	5	Aroba	1202
602	597	5	Golokwara	1177
603	597	5	Ocor	1664
604	597	5	Opam	1162
605	597	5	Sugur	2489
606	583	4	Amuria Town Council	9690
607	606	5	Akisim Ward	1619
608	606	5	Alira Ward	3054
609	606	5	Eastern Ward	4024
610	606	5	Okutoi Ward	993
611	583	4	Apeduru	18997
612	611	5	Ajaki	4202
613	611	5	Amucu	2876
614	611	5	Apeduru	5498
615	611	5	Odoon	3261
616	611	5	Omariai	3160
617	583	4	Asamuk	22836
618	617	5	Aparisa	3717
619	617	5	Atirir	3095
620	617	5	Dokolo	4131
621	617	5	Obur	4439
622	617	5	Ojamai	4016
623	617	5	Olekai	3438
624	583	4	Asamuk Town Council	6075
625	624	5	Asamuk Ward	1660
626	624	5	Ben Etonu Ward	1006
627	624	5	Fr Touber Ward	1797
628	624	5	Ocaga Ward	1612
629	583	4	Kuju	16149
630	629	5	Amilimil	1721
631	629	5	Amusus	2115
632	629	5	Angorom	1861
633	629	5	Aojakitoi	1571
634	629	5	Arapai	2488
635	629	5	Atuba	1167
636	629	5	Kuju	2761
637	629	5	Obar	2465
638	583	4	Wera	14490
639	638	5	Ajota	1552
640	638	5	Angole	1780
641	638	5	Aten	2514
642	638	5	Olianai	2508
643	638	5	Opiriai	1378
644	638	5	Osekai	1941
645	638	5	Wera	2817
646	583	4	Wera Town Council	4976
647	646	5	Central Ward	1359
648	646	5	Eastern Ward	1988
649	646	5	Western Ward	1629
650	583	4	Willa	19643
651	650	5	Abwanget	3317
652	650	5	Akisim	4012
653	650	5	Akum	4102
654	650	5	Alere	3398
655	650	5	Wila	4814
656	582	3	Orungo County	85003
657	656	4	Akeriau	19526
658	657	5	Aita	3485
659	657	5	Akeriau	3687
660	657	5	Okude	4663
661	657	5	Otubet	4751
662	657	5	Temele	2940
663	656	4	Morungatuny	12958
664	663	5	Aboket	1323
665	663	5	Aita	1912
666	663	5	Corner Stone	2162
667	663	5	Morungatuny	1818
668	663	5	Ogangai	1722
669	663	5	Ojukot	2039
670	663	5	Omodoi	1982
671	656	4	Ogolai	19060
672	671	5	Abeko	4514
673	671	5	Akore	3510
674	671	5	Ococia	4693
675	671	5	Odepe	2228
676	671	5	Ogolai	4115
677	656	4	Ogongora	9599
678	677	5	Dokolo	1119
679	677	5	Ocakai	2056
680	677	5	Oelai	972
681	677	5	Ogongora	1906
682	677	5	Olele	2133
683	677	5	Onyeba	1413
684	656	4	Olwa	12020
685	684	5	Agwanjua	2728
686	684	5	Awelu	2285
687	684	5	Ayola	2179
688	684	5	Jalam	2463
689	684	5	Olwa	2365
690	656	4	Orungo	8933
691	690	5	Adakun	1658
692	690	5	Amecha	1553
693	690	5	Moruinera	1781
694	690	5	Omoratok	1328
695	690	5	Orungo	1436
696	690	5	Owangai	1177
697	656	4	Orungo Town Council	2907
698	697	5	Anyaiki Ward	820
699	697	5	Apeduru Ward	542
700	697	5	Central Ward	662
701	697	5	Odukut Ward	883
702	3	2	Amuru	240814
703	702	3	Kilak North County	109510
704	703	4	Atiak	18473
705	704	5	Okidi	4585
706	704	5	Pacilo	5332
707	704	5	Parwaca	3729
708	704	5	Pupwonya	4827
709	703	4	Atiak Town Council	8044
710	709	5	Amoyokol Ward	2390
711	709	5	Kibogi Ward	993
712	709	5	Pabuga Ward	2257
713	709	5	Pagimoro Ward	2404
714	703	4	Elegu Town Council	13363
715	714	5	Bibia Ward	3342
716	714	5	Elegu Lorikwo Ward	8890
717	714	5	Kaladima Ward	1131
718	703	4	Opara	11827
719	718	5	Lalem	2412
720	718	5	Lulai	1761
721	718	5	Omee	1535
722	718	5	Palukere	1619
723	718	5	Pawel	1697
724	718	5	Pukumu	2803
725	703	4	Pabbo	31661
726	725	5	Gaya	2817
727	725	5	Labala	13850
728	725	5	Pabbo Kal	3017
729	725	5	Palwong	6619
730	725	5	Parubanga	5358
731	703	4	Pabbo Town Council	14372
732	731	5	Layik Ward	3492
733	731	5	Luzira Ward	5171
734	731	5	Pabbo Central Ward	5709
735	703	4	Pogo	11770
736	735	5	Ceri	1493
737	735	5	Ogwera	3116
738	735	5	Olinga	3970
739	735	5	Otorokume	3191
740	702	3	Kilak South County	131304
741	740	4	Amuru	36528
742	741	5	Acwera	12344
743	741	5	Okunged	6324
744	741	5	Pagak	5562
745	741	5	Pamuca	4340
746	741	5	Toro	7958
747	740	4	Amuru Town Council	17246
748	747	5	Amoyokoma Ward	3499
749	747	5	Lujoro Ward	4266
750	747	5	Otwee Ward	4181
751	747	5	Pogi Ward	5300
752	740	4	Guru Guru	20606
753	752	5	Amora	3983
754	752	5	Ayila	5891
755	752	5	Lamola	2679
756	752	5	Odur	1949
757	752	5	Opok	3070
758	752	5	Otici	3034
759	740	4	Lakang	14274
760	759	5	Atoro	1832
761	759	5	Bana	4366
762	759	5	Kololo	3889
763	759	5	Lajalula	4187
764	740	4	Lamogi	31290
765	764	5	Agwaryugi	7449
766	764	5	Coke	3622
767	764	5	Lacor	7291
768	764	5	Obbo	3715
769	764	5	Pagoro	3129
770	764	5	Palema	6084
771	740	4	Layima	11360
772	771	5	Alii	1579
773	771	5	Katatyer	1667
774	771	5	Lujoro	3746
775	771	5	Reckiceke	4368
776	3	2	Apac	221962
777	776	3	Apac Municipality	49593
778	777	4	Agullu Division	14175
779	778	5	Aminteng	2480
780	778	5	Awir Ward	2493
781	778	5	Odokomac Ward	2797
782	778	5	Te-Ibu Ward	2798
783	778	5	Wormwaka Ward	3607
784	777	4	Akere Division	11427
785	784	5	Angayiki Ward	3986
786	784	5	Ayera Ward	1188
787	784	5	Central Ward	4057
788	784	5	Dam Ward	2196
789	777	4	Arocha Division	15023
790	789	5	Adok Ward	2445
791	789	5	Atopi Ward	1391
792	789	5	Barodong Ward	1640
793	789	5	Ngec Ward	2535
794	789	5	Owang Ward	3722
795	789	5	Oyo Ward	1569
796	789	5	Temogo Ward	1721
797	777	4	Atik Division	8968
798	797	5	Bardek Ward	2962
799	797	5	Bung Ward	2743
800	797	5	Industrial Ward	1411
801	797	5	Olili Ward	1852
802	776	3	Maruzi County	99183
803	802	4	Akokoro	19521
804	803	5	Akokoro	4465
805	803	5	Awila	6552
806	803	5	Ayeolyec	2831
807	803	5	Kungu	5673
808	802	4	Akokoro Town Council	4318
809	808	5	Abyeibuti Ward	1224
810	808	5	Pabbo Ward	863
811	808	5	Tetugu Ward	2231
812	802	4	Apoi	26296
813	812	5	Alaro	5004
814	812	5	Amun	6031
815	812	5	Apoi	5327
816	812	5	Ayago	7144
817	812	5	Wansolo	2790
818	802	4	Ibuje	38356
819	818	5	Aganga	8214
820	818	5	Aketo	4307
821	818	5	Alworoceng	8835
822	818	5	Amii-Aberidwogo	2148
823	818	5	Amii-Amilo	9003
824	818	5	Tarogali	5849
825	802	4	Ibuje Town Council	10692
826	825	5	Aberidwogo Ward	4084
827	825	5	Alenga Ward	6608
828	776	3	Maruzi North County	73186
829	828	4	Apac	29825
830	829	5	Abedi	14062
831	829	5	Akere	2848
832	829	5	Atana	7067
833	829	5	Atopi	5848
834	828	4	Chegere	26648
835	834	5	Adem	3628
836	834	5	Atigolwok	4342
837	834	5	Chegere	5408
838	834	5	Kidilani	8554
839	834	5	Ongica	4716
840	828	4	Te-Boke	16713
841	840	5	Agong	1944
842	840	5	Barodilo	4360
843	840	5	Ilee	2867
844	840	5	Ololango	3675
845	840	5	Teboke	3867
846	3	2	Arua	159722
847	846	3	Vurra County	159722
848	847	4	Ajia	27786
849	848	5	Ajia	2454
850	848	5	Alivu	2015
851	848	5	Ayaa	2745
852	848	5	Ayaa-Yia	3483
853	848	5	Ewaa	5089
854	848	5	Nyirivu	3429
855	848	5	Ochoko	2126
856	848	5	Olevu	3509
857	848	5	Ombokoro	2936
858	847	4	Arivu	29652
859	858	5	Awika	6406
860	858	5	Eceko	5015
861	858	5	Ombavu	5227
862	858	5	Omoo	4427
863	858	5	Pajuru	3414
864	858	5	Ulupi	5163
865	847	4	Logiri	43716
866	865	5	Anyavu	9476
867	865	5	Chiaba	3954
868	865	5	Jiki	2646
869	865	5	Lazebu	8877
870	865	5	Okavu	6982
871	865	5	Oliba	3965
872	865	5	Ozoo	7816
873	847	4	Vurra	58568
874	873	5	Ajono	7776
875	873	5	Anzuu	4248
876	873	5	Ayavu	5321
877	873	5	Eruba	10941
878	873	5	Ezuku	4471
879	873	5	Kuluva	5316
880	873	5	Nyio	6782
881	873	5	Opia	4500
882	873	5	Ringili	3420
883	873	5	Tilevu	5793
884	3	2	Arua City	384656
885	884	3	Arua Central Division	59083
886	885	4	Arua Central Division	59083
887	886	5	Awindiri Ward	8527
888	886	5	Bazaar Ward	3181
889	886	5	Kenya Ward	11719
890	886	5	Mvara Ward	4205
891	886	5	Pangisa Ward	15649
892	886	5	Tanganyika Ward	15802
893	884	3	Ayivu Division	325573
894	893	4	Ayivu Division	325573
895	894	5	Adalafu Ward	17183
896	894	5	Aliba Ward	3840
897	894	5	Alivu-Aroi Ward	3507
898	894	5	Alivu-Pajulu Ward	10034
899	894	5	Ambeko Ward	5578
900	894	5	Anipi Ward	7630
901	894	5	Anyara Ward	6220
902	894	5	Anzu Ward	8782
903	894	5	Arivu Ward	11401
904	894	5	Ariwara Ward	8853
905	894	5	Bunyu Ward	3705
906	894	5	Bura Ward	4622
907	894	5	Driwala Ward	20567
908	894	5	Eleku Ward	4052
909	894	5	Etori Ward	8348
910	894	5	Ewadri Ward	5267
911	894	5	Kamule Ward	2641
912	894	5	Kati Ward	8416
913	894	5	Komite Ward	13436
914	894	5	Kubo Ward	5039
915	894	5	Lufe Ward	5517
916	894	5	Luvu Ward	7364
917	894	5	Mbaraka Ward	9504
918	894	5	Micu Ward	4492
919	894	5	Mite Ward	8382
920	894	5	Nyaracu Ward	5515
921	894	5	Nyio Ward	5352
922	894	5	Nyiovura Ward	10821
923	894	5	Odravu-Dadamu Ward	6021
924	894	5	Odravu-Manibe Ward	5524
925	894	5	Oduluba Ward	4322
926	894	5	Olevu Ward	5258
927	894	5	Ombachi-Adumi Ward	6688
928	894	5	Ombachi-Manibe Ward	3397
929	894	5	Ombokoro-Manibe Ward	3924
930	894	5	Ombokoro-Oluko Ward	3627
931	894	5	Onzivu Ward	13800
932	894	5	Oreku Ward	4528
933	894	5	Orugbo Ward	4134
934	894	5	Pokea Ward	14368
935	894	5	Robu-Aroi Ward	2809
936	894	5	Robu-Manibe Ward	1897
937	894	5	Tanganyika Ward	8082
938	894	5	Turu Ward	3585
939	894	5	Wandi Ward	2782
940	894	5	Yabiavoko Ward	3890
941	894	5	Yapi Ward	4001
942	894	5	Yivu Ward	6868
943	2	2	Budaka	281537
944	943	3	Budaka County	161059
945	944	4	Budaka	13003
946	945	5	Chali	3273
947	945	5	Gadumire	2650
948	945	5	Nampangala	3375
949	945	5	Sapiri	3705
950	944	4	Budaka Town Council	33120
951	950	5	Budaka Ward	5008
952	950	5	Bwase Ward	10516
953	950	5	Macholi Ward	8510
954	950	5	Nabweyo Ward	4290
955	950	5	Namengo Ward	4796
956	944	4	Kabuna	8509
957	956	5	Kabuna	2134
958	956	5	Kaperi	1415
959	956	5	Kotia	3573
960	956	5	Mutukula	1387
961	944	4	Kachomo	7430
962	961	5	Kodiri	4245
963	961	5	Kotinyanga	3185
964	944	4	Kachomo Town Council	12287
965	964	5	Bulalaka Ward	1754
966	964	5	Burweta Ward	3179
967	964	5	Kachomo Ward	3241
968	964	5	Kadenghe Ward	4113
969	944	4	Kaderuna	12646
970	969	5	Kaderuna	3767
971	969	5	Kebula	3751
972	969	5	Kiryolo	2967
973	969	5	Naungholi	2161
974	944	4	Kakule	17075
975	974	5	Kakule	3186
976	974	5	Kaperi	3464
977	974	5	Kasuleta	4606
978	974	5	Lerya	1489
979	974	5	Namusita	4330
980	944	4	Lyama Town Council	14676
981	980	5	Buyemba Ward	5258
982	980	5	Lyama Ward	2649
983	980	5	Nakisenye Ward	2638
984	980	5	Suni Ward	4131
985	944	4	Naboa Town Council	19156
986	985	5	Bunyekero	3903
987	985	5	Lupada	3663
988	985	5	Naboa	5306
989	985	5	Nangeye	6284
990	944	4	Nansanga	12191
991	990	5	Idudi A	4019
992	990	5	Idudi B	2938
993	990	5	Nansanga A	3473
994	990	5	Nansanga B	1761
995	944	4	Tademeri	10966
996	995	5	Nalugondo	2796
997	995	5	Naluli	3594
998	995	5	Namukalo	2161
999	995	5	Tademeri	2415
1000	943	3	Iki-Iki County	120478
1001	1000	4	Iki-Iki	5794
1002	1001	5	Bunaminto	1550
1003	1001	5	Kadenghe	4244
1004	1000	4	Iki-Iki Town Council	14525
1005	1004	5	Buloki Ward	5245
1006	1004	5	Iki-Iki Ward	2520
1007	1004	5	Kaitangole Ward	4779
1008	1004	5	Petete Ward	1981
1009	1000	4	Kadimukoli	14688
1010	1009	5	Kadimukoli	3208
1011	1009	5	Kositi	3314
1012	1009	5	Nachewu	3227
1013	1009	5	Sekulo	4939
1014	1000	4	Kakoli	10473
1015	1014	5	Kabyonga	3085
1016	1014	5	Kakoli	1855
1017	1014	5	Kavule	2867
1018	1014	5	Nyanza	2666
1019	1000	4	Kameruka	22105
1020	1019	5	Bupuchai	2944
1021	1019	5	Kameruka	4841
1022	1019	5	Lerya	5140
1023	1019	5	Nabugalo	4880
1024	1019	5	Nanzala	4300
1025	1000	4	Kamonkoli	10654
1026	1025	5	Bunyolo	5967
1027	1025	5	Jami	4687
1028	1000	4	Kamonkoli Town Council	9160
1029	1028	5	Kamonkoli North Ward	3096
1030	1028	5	Kamonkoli South Ward	6064
1031	1000	4	Katira	15711
1032	1031	5	Buloki	1742
1033	1031	5	Kadatumi	4461
1034	1031	5	Katira	5413
1035	1031	5	Kerekerene	4095
1036	1000	4	Mugiti	17368
1037	1036	5	Bukaligwoko	2390
1038	1036	5	Bunamwera	2552
1039	1036	5	Mugiti	2636
1040	1036	5	Nasenyi	2756
1041	1036	5	Nyanza	7034
1042	2	2	Bududa	268970
1043	1042	3	Bushigai County	43198
1044	1043	4	Bukigai	6553
1045	1044	5	Bumangoye	1357
1046	1044	5	Bumirume	1372
1047	1044	5	Bunamubi	1867
1048	1044	5	Bunaporo	1139
1049	1044	5	Butiliku	818
1050	1043	4	Bukigai Town Council	7248
1051	1050	5	Bumakuma Ward	1298
1052	1050	5	Bumatanda Ward	1887
1053	1050	5	Bunabwire Ward	828
1054	1050	5	Bunakuti Ward	1084
1055	1050	5	Mbelema Ward	1414
1056	1050	5	Nabingoma Ward	737
1057	1043	4	Bunatsami	5567
1058	1057	5	Bumabala	905
1059	1057	5	Bumutu	1065
1060	1057	5	Bunanyili	1435
1061	1057	5	Bunatsami	2162
1062	1043	4	Bushiribo	6881
1063	1062	5	Bufukhula	1053
1064	1062	5	Bukhwaka	353
1065	1062	5	Bumasa	2155
1066	1062	5	Bunambale	539
1067	1062	5	Bushiribo	875
1068	1062	5	Buswalikha	935
1069	1062	5	Nabafu	971
1070	1043	4	Kikholo Town Council	8601
1071	1070	5	Bubuyera Ward	1376
1072	1070	5	Bulobi Ward	1247
1073	1070	5	Bunanyiri Ward	1531
1074	1070	5	Bushunya Ward	1434
1075	1070	5	Kikholo Ward	2041
1076	1070	5	Nshitsubo Ward	972
1077	1043	4	Nabweya	8348
1078	1077	5	Bunakhayoti	2882
1079	1077	5	Bunandutu	1634
1080	1077	5	Bunatsumya	2555
1081	1077	5	Bunyanga	1277
1082	1042	3	Lutseshe County	118297
1083	1082	4	Bubiita	8290
1084	1083	5	Maaba	2126
1085	1083	5	Shikhulusi	1341
1086	1083	5	Shishendu	2014
1087	1083	5	Shiteka	2809
1088	1082	4	Bufuma	7612
1089	1088	5	Bufuma	1156
1090	1088	5	Bulatse	2091
1091	1088	5	Bushiswabula	2749
1092	1088	5	Nabooti	801
1093	1088	5	Namakukye	815
1094	1082	4	Bukalasi	11708
1095	1094	5	Bukalasi	2266
1096	1094	5	Bukibumbi	740
1097	1094	5	Kasuni	970
1098	1094	5	Mabina	942
1099	1094	5	Masakhanu	1065
1100	1094	5	Nabulalo	1977
1101	1094	5	Namarumba	641
1102	1094	5	Ngaame	1333
1103	1094	5	Summe	1774
1104	1082	4	Bulucheke	5865
1105	1104	5	Bumaemba	596
1106	1104	5	Bumasata	1687
1107	1104	5	Bumwalye	1954
1108	1104	5	Bunantsushi	1628
1109	1082	4	Bumayoka	7537
1110	1109	5	Bubukasha	1557
1111	1109	5	Bukhayenjele	801
1112	1109	5	Bumayoka	890
1113	1109	5	Bunandutu	542
1114	1109	5	Matsakha	1719
1115	1109	5	Namukhuyu	1227
1116	1109	5	Nangobe	801
1117	1082	4	Bumwalukani	7022
1118	1117	5	Bumwalukani	2897
1119	1117	5	Bunamulembwa	680
1120	1117	5	Sakusaku	1597
1121	1117	5	Shikholo	1848
1122	1082	4	Bundesi	11771
1123	1122	5	Bukibalera	1208
1124	1122	5	Bumasime	1027
1125	1122	5	Bunamboka	605
1126	1122	5	Bundesi	976
1127	1122	5	Maika	825
1128	1122	5	Nakhashisi	708
1129	1122	5	Namalila	568
1130	1122	5	Namasheti	1034
1131	1122	5	Nametsi	1068
1132	1122	5	Renyeli	1203
1133	1122	5	Shibanga	587
1134	1122	5	Tunwatsi	1962
1135	1082	4	Bushiyi	12193
1136	1135	5	Burafula	3268
1137	1135	5	Bushiyi	3755
1138	1135	5	Matuwa	1077
1139	1135	5	Nakungulyu	651
1140	1135	5	Namamuka	1227
1141	1135	5	Namirumba	2215
1142	1082	4	Busiriwa	5638
1143	1142	5	Bikimaswa	569
1144	1142	5	Bukhone	587
1145	1142	5	Buneboshe	892
1146	1142	5	Buraba	1618
1147	1142	5	Busiriwa	482
1148	1142	5	Buyi	1490
1149	1082	4	Buwali	8248
1150	1149	5	Bugobero	1964
1151	1149	5	Bunamwamba	3222
1152	1149	5	Buwali	1311
1153	1149	5	Buwashi	1751
1154	1082	4	Kuushu Town Council	8865
1155	1154	5	Bunamee Ward	3038
1156	1154	5	Bunashiswa Ward	1861
1157	1154	5	Ibaale Ward	2505
1158	1154	5	Kitsawa Ward	1461
1159	1082	4	Mabono	10414
1160	1159	5	Bunatondo	1212
1161	1159	5	Kitsatsa	1696
1162	1159	5	Mabono	1998
1163	1159	5	Makukye	1185
1164	1159	5	Rukuru	2183
1165	1159	5	Ulukusi	2140
1166	1082	4	Nalwanza	13134
1167	1166	5	Bumakhwa	1100
1168	1166	5	Bumakita	3444
1169	1166	5	Bumusi	1409
1170	1166	5	Bumusi Upper	1415
1171	1166	5	Bunango	3378
1172	1166	5	Buwagiyu	2388
1173	1042	3	Manjiya County	107475
1174	1173	4	Bududa	8506
1175	1174	5	Bukhabusi	1045
1176	1174	5	Bukhalali	658
1177	1174	5	Bukhatondi	831
1178	1174	5	Buloli	170
1179	1174	5	Bunamashe	581
1180	1174	5	Bunamutunyi	736
1181	1174	5	Bunawatsi	567
1182	1174	5	Buneembe	695
1183	1174	5	Busai	1373
1184	1174	5	Bushimwemwe	369
1185	1174	5	Bushinyekwa	639
1186	1174	5	Shisabasi	842
1187	1173	4	Bududa Town Council	13964
1188	1187	5	Buloli North Ward	4456
1189	1187	5	Buloli South Ward	2226
1190	1187	5	Bunamutunyi Ward	1631
1191	1187	5	Buwanabisi Ward	2352
1192	1187	5	Nashula Ward	3299
1193	1173	4	Bukibino	6493
1194	1193	5	Bukibino	1320
1195	1193	5	Bukimuma	782
1196	1193	5	Bukirimwa	875
1197	1193	5	Bunamanda	1070
1198	1193	5	Namaitsu	1645
1199	1193	5	Wameyo	801
1200	1173	4	Bukibokolo	18233
1201	1200	5	Buirimbi	5282
1202	1200	5	Bukari	2994
1203	1200	5	Bulumino	2738
1204	1200	5	Bunamukye	3076
1205	1200	5	Buwakhata	4143
1206	1173	4	Bumasheti	15087
1207	1206	5	Bukhura	3640
1208	1206	5	Bukibokolo	3779
1209	1206	5	Bunamee	5253
1210	1206	5	Busamali	2415
1211	1173	4	Bunabutiti	10817
1212	1211	5	Bubore	1819
1213	1211	5	Bubungi	3722
1214	1211	5	Bunabutiti	3274
1215	1211	5	Bunamanda	1090
1216	1211	5	Namatiale	912
1217	1173	4	Bushika	11859
1218	1217	5	Bufutsa	2472
1219	1217	5	Bukhaukha	1559
1220	1217	5	Bumushiso	2383
1221	1217	5	Namakuto	4122
1222	1217	5	Naposhi	1323
1223	1173	4	Nakatsi	10200
1224	1223	5	Bumukonya	2547
1225	1223	5	Bumusenye	3049
1226	1223	5	Bunambatsu	2209
1227	1223	5	Bunatsimi	2395
1228	1173	4	Nangako Town Council	12316
1229	1228	5	Khama Ward	1823
1230	1228	5	Mukini Ward	1717
1231	1228	5	Munkaga Ward	2389
1232	1228	5	Mutsitsi Ward	2203
1233	1228	5	Nangako Ward	4184
1234	2	2	Bugiri	480345
1235	1234	3	Bugiri Municipality	31819
1236	1235	4	Eastern Division	16436
1237	1236	5	Naluwerere Ward	8527
1238	1236	5	Nkusi Ward	7909
1239	1235	4	Western Division	15383
1240	1239	5	Bwole Ward	8406
1241	1239	5	Ndifakulya A Ward	6977
1242	1234	3	Bukooli County	448526
1243	1242	4	Budhaya	22413
1244	1243	5	Budhaya	6578
1245	1243	5	Bukatu	11207
1246	1243	5	Mayuge Rural	4628
1247	1242	4	Bulesa	24401
1248	1247	5	Buluwe	6194
1249	1247	5	Iggwe	6323
1250	1247	5	Kitodha	4546
1251	1247	5	Namasere	7338
1252	1242	4	Bulidha	28518
1253	1252	5	Bulidha A	5727
1254	1252	5	Bulidha B	2064
1255	1252	5	Isakabusolo	4198
1256	1252	5	Makoma	6255
1257	1252	5	Nabigingo	6114
1258	1252	5	Wakawaka	4160
1259	1242	4	Buluguyi	19630
1260	1259	5	Bufunda	7175
1261	1259	5	Bugayi	4715
1262	1259	5	Nsango	7740
1263	1242	4	Busowa Town Council	19432
1264	1263	5	Budunduli Ward	2694
1265	1263	5	Bulume Ward	3661
1266	1263	5	Nabikaka Ward	5214
1267	1263	5	Nakawa Ward	1690
1268	1263	5	Nakidudula Ward	4674
1269	1263	5	Nawandhuki Ward	1499
1270	1242	4	Buwunga	42754
1271	1270	5	Bubugo	5006
1272	1270	5	Bupala	6054
1273	1270	5	Busoga	3975
1274	1270	5	Buwunga	5318
1275	1270	5	Kavule	2962
1276	1270	5	Luwooko	5565
1277	1270	5	Magoola	5420
1278	1270	5	Mawanga	2345
1279	1270	5	Nambale	6109
1280	1242	4	Buwuni Town Council	18448
1281	1280	5	Buwuni Rural Ward	2435
1282	1280	5	Buwuni Ward	4004
1283	1280	5	Kasebere Ward	2324
1284	1280	5	Makhoma North Ward	2152
1285	1280	5	Makhoma South Ward	2365
1286	1280	5	Nainala Ward	2906
1287	1280	5	Namasere B Ward	1268
1288	1280	5	Nankonkolo Ward	994
1289	1242	4	Iwemba	25691
1290	1289	5	Bugeso	4435
1291	1289	5	Buyala	6020
1292	1289	5	Iwemba	5112
1293	1289	5	Nabirere	5807
1294	1289	5	Nambo	4317
1295	1242	4	Kapyanga	56199
1296	1295	5	Bugiri A	8237
1297	1295	5	Bugubo	7924
1298	1295	5	Bugunga	7704
1299	1295	5	Kiseitaka	7685
1300	1295	5	Nakavule	5803
1301	1295	5	Namukonge	9655
1302	1295	5	Ndifakulya	9191
1303	1242	4	Mayuge Town Council	12481
1304	1303	5	Bude Ward	2378
1305	1303	5	Buwolya Ward	1476
1306	1303	5	Kimasa Ward	2023
1307	1303	5	Kololo Ward	2312
1308	1303	5	Mayuge Ward	2092
1309	1303	5	Nile Ward	2200
1310	1242	4	Mutelele Town Council	12162
1311	1310	5	Busini Ward	1174
1312	1310	5	Lyavala Ward	1385
1313	1310	5	Mutanda Ward	2602
1314	1310	5	Muterere East Ward	3797
1315	1310	5	Nakasero Ward	3204
1316	1242	4	Muterere	21895
1317	1316	5	Bululu	6585
1318	1316	5	Kayogera	6512
1319	1316	5	Kitumba	8798
1320	1242	4	Muwayo Town Council	21084
1321	1320	5	Buduma Ward	8161
1322	1320	5	Buluguyi Ward	6123
1323	1320	5	Muwayo Ward	6800
1324	1242	4	Nabukalu	35696
1325	1324	5	Bukubansiri	3539
1326	1324	5	Butyabule	8838
1327	1324	5	Isegero	7348
1328	1324	5	Lwanika	4961
1329	1324	5	Nkaiza	3919
1330	1324	5	Wangobo	7091
1331	1242	4	Nabukalu Town Council	11054
1332	1331	5	Bubalya	2062
1333	1331	5	Bukyansiko Ward	1858
1334	1331	5	Kalulu Ward	984
1335	1331	5	Kasita Ward	1390
1336	1331	5	Luya Ward	1329
1337	1331	5	Nabukalu Ward	1788
1338	1331	5	Nakivamba Ward	1643
1339	1242	4	Namayemba Town Council	18198
1340	1339	5	Bukonde Ward	1544
1341	1339	5	Gulimwoyo Ward	4577
1342	1339	5	Isagaza Ward	2490
1343	1339	5	Kafufu Ward	3630
1344	1339	5	Kasule Ward	3438
1345	1339	5	Namabugo Ward	2519
1346	1242	4	Nankoma	31647
1347	1346	5	Isegero	6872
1348	1346	5	Matovu	6310
1349	1346	5	Namakoko	9022
1350	1346	5	Nsono	9443
1351	1242	4	Nankoma Town Council	26823
1352	1351	5	Itakaibolu Ward	4364
1353	1351	5	Masita Ward	2874
1354	1351	5	Nakasita Ward	2167
1355	1351	5	Namuntenga Ward	2994
1356	1351	5	Nankoma Central Ward	6207
1357	1351	5	Nankoma East Ward	4282
1358	1351	5	Nawango Ward	3935
1359	2	2	Bugweri	211511
1360	1359	3	Bugweri County	211511
1361	1360	4	Busembatia Town Council	21869
1362	1361	5	Busembatia Central Ward	2754
1363	1361	5	Busembatia Market Ward	4850
1364	1361	5	Buyirima Ward	3103
1365	1361	5	Kakoge Ward	5402
1366	1361	5	Majengo Ward	5760
1367	1360	4	Busesa Town Council	19021
1368	1367	5	Butende Ward	8461
1369	1367	5	Ibaako Ward	10560
1370	1360	4	Buyanga	42674
1371	1370	5	Bulunguli	6036
1372	1370	5	Bumoozi	9066
1373	1370	5	Buwooya	10440
1374	1370	5	Bwigula	6482
1375	1370	5	Kalalu	5959
1376	1370	5	Lubira	4691
1377	1360	4	Ibulanku	23775
1378	1377	5	Buniantole	2104
1379	1377	5	Ibulanku	5283
1380	1377	5	Namiganda	1990
1381	1377	5	Nawansega	6147
1382	1377	5	Nsaale	8251
1383	1360	4	Idudi Town Council	23784
1384	1383	5	Idudi A Ward	6794
1385	1383	5	Idudi B Ward	2608
1386	1383	5	Idudi C Ward	1666
1387	1383	5	Idudi D Ward	3671
1388	1383	5	Kikunyu Ward	7430
1389	1383	5	Mufumi Ward	1615
1390	1360	4	Igombe	18492
1391	1390	5	Bubenge	3658
1392	1390	5	Igombe	5817
1393	1390	5	Kikunyu	5540
1394	1390	5	Walanga	3477
1395	1360	4	Makuutu	33319
1396	1395	5	Kasozi	12854
1397	1395	5	Kigulamo	5077
1398	1395	5	Makandwa	6652
1399	1395	5	Makuutu	8736
1400	1360	4	Namalemba	28577
1401	1400	5	Idinda	7080
1402	1400	5	Minani	7095
1403	1400	5	Namalemba	9757
1404	1400	5	Namunyumya	4645
1405	4	2	Buhweju	167921
1406	1405	3	Buhweju County	69238
1407	1406	4	Bitsya	9007
1408	1407	5	Bitsya	3559
1409	1407	5	Kitega	2113
1410	1407	5	Kyanyabita	1127
1411	1407	5	Muzeiguru	2208
1412	1406	4	Buhunga	11417
1413	1412	5	Buhunga	3047
1414	1412	5	Kankara	2722
1415	1412	5	Kyenjogyera	2786
1416	1412	5	Mushasha	2862
1417	1406	4	Karungu	19065
1418	1417	5	Butuuro	2189
1419	1417	5	Ibogora	1642
1420	1417	5	Kamukaki	1990
1421	1417	5	Karungu	2720
1422	1417	5	Kasharara	2328
1423	1417	5	Katara	3449
1424	1417	5	Rugongo	2938
1425	1417	5	Rwankondo	1809
1426	1406	4	Kashenyi-Kajani Town Council	11447
1427	1426	5	Butare Ward	3204
1428	1426	5	Kashenyi Ward	2851
1429	1426	5	Kibimba Ward	1931
1430	1426	5	Ntungamo Ward	3461
1431	1406	4	Nsiika Town Council	7435
1432	1431	5	Kicuzi Ward	1106
1433	1431	5	Kyajura Ward	1056
1434	1431	5	Nsiika Ward	3749
1435	1431	5	Rugaba Ward	1524
1436	1406	4	Rwengwe	10867
1437	1436	5	Bwoga	2883
1438	1436	5	Kaniga	2056
1439	1436	5	Kyankanda	1894
1440	1436	5	Kyeyare	1490
1441	1436	5	Nyakishojwa	2544
1442	1405	3	Buhweju West County	98683
1443	1442	4	Bihanga	16221
1444	1443	5	Karembe	3081
1445	1443	5	Nyakaziba	3316
1446	1443	5	Nyakishenyi	2833
1447	1443	5	Nyakitaraka	2001
1448	1443	5	Rukiri	2805
1449	1443	5	Runengo	2185
1450	1442	4	Burere	8960
1451	1450	5	Rushambya	4675
1452	1450	5	Rwajere	4285
1453	1442	4	Engaju	16810
1454	1453	5	Engaaju	5796
1455	1453	5	Kajumbura	2873
1456	1453	5	Katongo	3889
1457	1453	5	Kyamahungu	1525
1458	1453	5	Kyooma	2727
1459	1442	4	Kyahenda	10310
1460	1459	5	Kemikyera	2782
1461	1459	5	Kiyanja	1955
1462	1459	5	Kyahenda	2428
1463	1459	5	Nyamihira	3145
1464	1442	4	Nyakashaka Town Council	7652
1465	1464	5	Nyakashaka Ward	2644
1466	1464	5	Nyakitoko Ward	2855
1467	1464	5	Rwemoma Ward	2153
1468	1442	4	Nyakaziba Town Council	4521
1469	1468	5	Kangarama Ward	1731
1470	1468	5	Kitookye Ward	784
1471	1468	5	Nyakaziba Ward	2006
1472	1442	4	Nyakishana	25235
1473	1472	5	Kabegaramire	3990
1474	1472	5	Kamuhiga	1675
1475	1472	5	Katinda	1090
1476	1472	5	Kiramira	2187
1477	1472	5	Kyamato	1868
1478	1472	5	Mabanga	1275
1479	1472	5	Muraaro	1850
1480	1472	5	Mutongo	2228
1481	1472	5	Nyarujoje	2636
1482	1472	5	Rukondo	2207
1483	1472	5	Rushayo	2946
1484	1472	5	Rwanyamabare	1283
1485	1442	4	Rubengye	8974
1486	1485	5	Kayonza	2109
1487	1485	5	Kitojo	2027
1488	1485	5	Nyakahita	2410
1489	1485	5	Rubengye	2428
1490	1	2	Buikwe	520158
1491	1490	3	Buikwe County	188879
1492	1491	4	Buikwe	19961
1493	1492	5	Kitazi	6097
1494	1492	5	Malongwe	6622
1495	1492	5	Ssugu	7242
1496	1491	4	Buikwe Town Council	20665
1497	1496	5	Buikwe Ward	10475
1498	1496	5	Lweru Ward	10190
1499	1491	4	Kiyindi Town Council	21931
1500	1499	5	Goli Ward	3067
1501	1499	5	Kiyindi Ward	12047
1502	1499	5	Zzinga Ward	6817
1503	1491	4	Najja	36097
1504	1503	5	Busagazi	4193
1505	1503	5	Gulama	4164
1506	1503	5	Kisiimba	8555
1507	1503	5	Mawotto	8330
1508	1503	5	Namatovu	4344
1509	1503	5	Tukulu	6511
1510	1491	4	Ngogwe	43527
1511	1510	5	Dungi	10046
1512	1510	5	Kikwayi	4806
1513	1510	5	Kiringo	7637
1514	1510	5	Lubongo	5354
1515	1510	5	Namulesa	10103
1516	1510	5	Ndolwa	5581
1517	1491	4	Nkokonjeru Town Council	14621
1518	1517	5	Bukasa Ward	7357
1519	1517	5	Mulajje Ward	3416
1520	1517	5	Nkokonjeru Ward	3848
1521	1491	4	Ssi	32077
1522	1521	5	Bbinga	2888
1523	1521	5	Kimera	2102
1524	1521	5	Koba	7584
1525	1521	5	Lugala	5395
1526	1521	5	Lugoba	4003
1527	1521	5	Muvo	2023
1528	1521	5	Namukuma	3807
1529	1521	5	Zitwe	4275
1530	1490	3	Lugazi Municipality	129795
1531	1530	4	Central Division	38392
1532	1531	5	Kabowa Ward	2621
1533	1531	5	Kawotto Ward	2617
1534	1531	5	Kikawula Ward	9184
1535	1531	5	Nakazadde Ward	12695
1536	1531	5	Namengo Ward	11275
1537	1530	4	Kawolo Division	53010
1538	1537	5	Bibbo Ward	5944
1539	1537	5	Bulyanteete Ward	6144
1540	1537	5	Busaabaga Ward	2946
1541	1537	5	Butinindi Ward	12277
1542	1537	5	Kigenda Ward	5044
1543	1537	5	Kiteza Ward	12892
1544	1537	5	Luwayo Ward	5778
1545	1537	5	Sagazi Ward	1985
1546	1530	4	Najjembe Division	38393
1547	1546	5	Buvunya Ward	5054
1548	1546	5	Buwoola Ward	2174
1549	1546	5	Kabanga Ward	7069
1550	1546	5	Kinoni Ward	3291
1551	1546	5	Kitigoma Ward	6425
1552	1546	5	Kizigo Ward	4911
1553	1546	5	Nsakya Ward	9469
1554	1490	3	Njeru Municipality	201484
1555	1554	4	Njeru Division	86092
1556	1555	5	Njeru East Ward	11793
1557	1555	5	Njeru North Ward	9109
1558	1555	5	Njeru South Ward	22299
1559	1555	5	Njeru West Ward	42891
1560	1554	4	Nyenga Division	59312
1561	1560	5	Buziika (b)	4285
1562	1560	5	Kabizzi	9814
1563	1560	5	Namabu	13364
1564	1560	5	Nyenga	8813
1565	1560	5	Ssunga	6240
1566	1560	5	Tongolo	16796
1567	1554	4	Wakisi Division	56080
1568	1567	5	Kalagala	6300
1569	1567	5	Kkonko	6098
1570	1567	5	Malindi	13747
1571	1567	5	Nakalanga	7254
1572	1567	5	Naminya	14679
1573	1567	5	Wakisi	8002
1574	2	2	Bukedea	282864
1575	1574	3	Bukedea County	206638
1576	1575	4	Aminit	13196
1577	1576	5	Aminit	1774
1578	1576	5	Angangam	1616
1579	1576	5	Busano	1086
1580	1576	5	Kalapata	1823
1581	1576	5	Kalengo	2477
1582	1576	5	Kayukum	1323
1583	1576	5	Okum	3097
1584	1575	4	Bukedea	20063
1585	1584	5	Adodoi	950
1586	1584	5	Akero	1672
1587	1584	5	Akuoro	1536
1588	1584	5	Aputiputi	1584
1589	1584	5	Kajamaka	681
1590	1584	5	Kaloko	1694
1591	1584	5	Kamon	3574
1592	1584	5	Kasoka	1733
1593	1584	5	Kokutu	1479
1594	1584	5	Okichira	1576
1595	1584	5	Okolimeri	1983
1596	1584	5	Tank	1601
1597	1575	4	Bukedea Town Council	15061
1598	1597	5	Bukedea Ward	2002
1599	1597	5	Emokori Ward	1520
1600	1597	5	Kachabule Ward	3524
1601	1597	5	Kide Ward	2369
1602	1597	5	Okunguro Complex Ward	1009
1603	1597	5	Okunguro Parents Ward	2247
1604	1597	5	Oswapai Ward	937
1605	1597	5	Tamula Ward	1453
1606	1575	4	Kabarwa	22272
1607	1606	5	Akungur	1458
1608	1606	5	Kabarwa	1544
1609	1606	5	Kachabule	1881
1610	1606	5	Kachede	2296
1611	1606	5	Kakori	2277
1612	1606	5	Kalou	1021
1613	1606	5	Kamuno	2207
1614	1606	5	Kodike	1752
1615	1606	5	Kotiokot	1886
1616	1606	5	Magara	2380
1617	1606	5	Takaramian	1947
1618	1606	5	Tokor	1623
1619	1575	4	Kamutur	17329
1620	1619	5	Abilaep	1839
1621	1619	5	Acomai	699
1622	1619	5	Aereere	1060
1623	1619	5	Akakaat	2562
1624	1619	5	Akou- Etom	1357
1625	1619	5	Amujeju	442
1626	1619	5	Kamutur	1660
1627	1619	5	Kasera	1465
1628	1619	5	Kocus	1719
1629	1619	5	Komongomeri	2202
1630	1619	5	Tajar	2324
1631	1575	4	Kangole	20313
1632	1631	5	Kadacar	2191
1633	1631	5	Kakurau	1798
1634	1631	5	Kakutot	1784
1635	1631	5	Kaleu	2472
1636	1631	5	Kamailuk	2040
1637	1631	5	Kangole	2161
1638	1631	5	Kaparis	1745
1639	1631	5	Kobaale	627
1640	1631	5	Koreng	3540
1641	1631	5	Osanyuk	1955
1642	1575	4	Kidongole	20861
1643	1642	5	Chodong	3561
1644	1642	5	Kadoa	2175
1645	1642	5	Kalupo	2615
1646	1642	5	Kanyamutamu	1636
1647	1642	5	Kanyanga	3352
1648	1642	5	Kidongole	1363
1649	1642	5	Kidongole Town Board	1847
1650	1642	5	Koboli	2028
1651	1642	5	Kotolutu	2284
1652	1575	4	Kocheka	21679
1653	1652	5	Atiriri	2446
1654	1652	5	Gagama	1628
1655	1652	5	Kachage	1549
1656	1652	5	Kakere	1598
1657	1652	5	Kocheka	2841
1658	1652	5	Kokolotum	1974
1659	1652	5	Okobwa	2813
1660	1652	5	Omoniek	1803
1661	1652	5	Omonyono	2868
1662	1652	5	Suula	2159
1663	1575	4	Koena	17197
1664	1663	5	Kachul	2198
1665	1663	5	Kajamaka	2707
1666	1663	5	Katekwan	1107
1667	1663	5	Katekwan Town Board	1652
1668	1663	5	Kawo	1954
1669	1663	5	Koena	2245
1670	1663	5	Kosire	1795
1671	1663	5	Kotwongo	1067
1672	1663	5	Oluwa	2472
1673	1575	4	Kolir	18321
1674	1673	5	Agor	1022
1675	1673	5	Amuen	1508
1676	1673	5	Apopong	2109
1677	1673	5	Kagoloto	765
1678	1673	5	Kanyipa	1734
1679	1673	5	Kareu	668
1680	1673	5	Kaseny	623
1681	1673	5	Kodiata	1311
1682	1673	5	Kolir	2107
1683	1673	5	Kopeta	724
1684	1673	5	Miroi	903
1685	1673	5	Oluwa	2175
1686	1673	5	Omidil	1423
1687	1673	5	Tukum	1249
1688	1575	4	Malera	20346
1689	1688	5	Abititi	2037
1690	1688	5	Kachoc	3470
1691	1688	5	Kachonga	1734
1692	1688	5	Kanyanga	2458
1693	1688	5	Kasechi	1920
1694	1688	5	Kokwech	2467
1695	1688	5	Malera	3215
1696	1688	5	Okouba	3045
1697	1574	3	Kachumbala County	76226
1698	1697	4	Aligoi	16372
1699	1698	5	Aligoi	2271
1700	1698	5	Bududa	2103
1701	1698	5	Kachabule	1394
1702	1698	5	Kakerei	3481
1703	1698	5	Kongatuny	1355
1704	1698	5	Kotia	2346
1705	1698	5	Mukongoro	3422
1706	1697	4	Kachumbala	12186
1707	1706	5	Aputiput	2299
1708	1706	5	Dadir	1425
1709	1706	5	Kachaboi	983
1710	1706	5	Kachumbala	2729
1711	1706	5	Kapaang	2322
1712	1706	5	Mukura	914
1713	1706	5	Obur	1514
1714	1697	4	Komuge	15399
1715	1714	5	Kadesok	2206
1716	1714	5	Kakira	2150
1717	1714	5	Kawo	1196
1718	1714	5	Kokwakipi	1427
1719	1714	5	Komuge	1475
1720	1714	5	Koutulai	2038
1721	1714	5	Manga	1861
1722	1714	5	Omonyono	1580
1723	1714	5	Ongaara	1466
1724	1697	4	Kongunga Town Council	17624
1725	1724	5	Airogo Ward	2353
1726	1724	5	Aputon Ward	1274
1727	1724	5	Bungokho Ward	496
1728	1724	5	Kapuyan Ward	671
1729	1724	5	Komelekes Ward	2671
1730	1724	5	Komuraikerei Ward	2674
1731	1724	5	Kongoidi Ward	1779
1732	1724	5	Kongunga Ward	2424
1733	1724	5	Nalugai Ward	976
1734	1724	5	Olasai Ward	972
1735	1724	5	Otimonga Ward	1334
1736	1697	4	Kwarikwar	14645
1737	1736	5	Amus	3307
1738	1736	5	Apujan	1451
1739	1736	5	Kabwalin	2306
1740	1736	5	Kachuru	1723
1741	1736	5	Komolo	1037
1742	1736	5	Kwarikwari	1769
1743	1736	5	Nyakoi	1440
1744	1736	5	Sapir	1612
1745	1	2	Bukomansimbi	197568
1746	1745	3	Bukomansimbi North County	108783
1747	1746	4	Bigasa	24628
1748	1747	5	Butalaga	6658
1749	1747	5	Gongwe	6293
1750	1747	5	Kiteera	5186
1751	1747	5	Mbirizi	6491
1752	1746	4	Bukango	14813
1753	1752	5	Bukango	3655
1754	1752	5	Kalungu	3277
1755	1752	5	Kitemi	2314
1756	1752	5	Kyaziiza	5567
1757	1746	4	Bukomansimbi Town Council	16747
1758	1757	5	Bukomansimbi Central Ward	7090
1759	1757	5	Kigungumika Ward	3318
1760	1757	5	Kirembeko Ward	1348
1761	1757	5	Kisagazi Ward	2628
1762	1757	5	Kyango Ward	2363
1763	1746	4	Kagologolo Town Council	6323
1764	1763	5	Kagologolo Ward	3091
1765	1763	5	Mbaale Ward	2036
1766	1763	5	Mpaama Ward	1196
1767	1746	4	Kigangazzi Town Council	15672
1768	1767	5	Busagula Ward	6624
1769	1767	5	Kayunga Ward	3662
1770	1767	5	Kisaba Ward	2593
1771	1767	5	Mbiriizi Ward	2793
1772	1746	4	Kitanda	30600
1773	1772	5	Gayaaza	7306
1774	1772	5	Luwoko	5432
1775	1772	5	Makukuulu	11918
1776	1772	5	Mitigyera	4956
1777	1772	5	Ndeeba	988
1778	1745	3	Bukomansimbi South County	88785
1779	1778	4	Butenga	32387
1780	1779	5	Kassebwera	8816
1781	1779	5	Kawoko	9170
1782	1779	5	Kisiita	6891
1783	1779	5	Kyankole	7510
1784	1778	4	Butenga Town Council	16900
1785	1784	5	Butenga Ward	3204
1786	1784	5	Kabigi Ward	3790
1787	1784	5	Mbaale Ward	4085
1788	1784	5	Meeru Ward	3883
1789	1784	5	Mununyu Ward	1938
1790	1778	4	Kibinge	39498
1791	1790	5	Butayunja	7103
1792	1790	5	Kiryasaaka	7699
1793	1790	5	Kisojjo	7078
1794	1790	5	Maleku	11036
1795	1790	5	Mirambi	6582
1796	2	2	Bukwo	114396
1797	1796	3	Kongasis County	66217
1798	1797	4	Amanang	5752
1799	1798	5	Amanang	1655
1800	1798	5	Chebirbei	1252
1801	1798	5	Cheboi	1079
1802	1798	5	Kubulwo	396
1803	1798	5	Sosho	1370
1804	1797	4	Bukwa	4766
1805	1804	5	Kamutungon	704
1806	1804	5	Kokopchaya	564
1807	1804	5	Kongta	625
1808	1804	5	Kululu	1497
1809	1804	5	Muimet	1376
1810	1797	4	Bukwo Town Council	11359
1811	1810	5	Kabasken Ward	1769
1812	1810	5	Kapkureson Ward	2053
1813	1810	5	Kapsukwar Ward	3119
1814	1810	5	Torasis Ward	4418
1815	1797	4	Chepkwasta	6079
1816	1815	5	Central	484
1817	1815	5	Chebinyiny	448
1818	1815	5	Chemuron	284
1819	1815	5	Chepkwasta	644
1820	1815	5	Kapsabit	639
1821	1815	5	Kapsekek	601
1822	1815	5	Mokotu	680
1823	1815	5	Sungora	528
1824	1815	5	Titim	975
1825	1815	5	Torokyo	796
1826	1797	4	Kapkoros	6038
1827	1826	5	Kapkoros	1343
1828	1826	5	Kaproben	919
1829	1826	5	Kawimbi	935
1830	1826	5	Reberon	832
1831	1826	5	Rotyo	827
1832	1826	5	Senendet	1182
1833	1797	4	Kapnandi Town Council	3582
1834	1833	5	Chemuron Ward	549
1835	1833	5	Kapnandi Ward	1172
1836	1833	5	Kaptomologon Ward	540
1837	1833	5	Lagam Ward	514
1838	1833	5	Lulu Ward	286
1839	1833	5	Mokoywet Ward	521
1840	1797	4	Kapsarur	4046
1841	1840	5	Chemweyet	973
1842	1840	5	Chepkuto	421
1843	1840	5	Cheptoror	538
1844	1840	5	Kapsarur	802
1845	1840	5	Kapta	634
1846	1840	5	Kiretei	678
1847	1797	4	Kaptererwo	8368
1848	1847	5	Chebinyiny	1959
1849	1847	5	Kapkoloswo	1924
1850	1847	5	Kaptali	2439
1851	1847	5	Kaptererwo	2046
1852	1797	4	Senendet	3732
1853	1852	5	Chemwabit	1273
1854	1852	5	Kapkomboloy	756
1855	1852	5	Kapkomol	558
1856	1852	5	Rwanda	1145
1857	1797	4	Suam	5804
1858	1857	5	Chepkusawar	907
1859	1857	5	Kabyoyon	1273
1860	1857	5	Kapkweno	1260
1861	1857	5	Matimbei	2364
1862	1797	4	Suam Town Council	6691
1863	1862	5	Kongasis Ward	1210
1864	1862	5	Kurangur Ward	1485
1865	1862	5	Kwirwot Ward	899
1866	1862	5	Mosop Ward	1004
1867	1862	5	Rakwayandet Ward	620
1868	1862	5	Suam Ward	1473
1869	1796	3	T'Oo County	48179
1870	1869	4	Brim	3514
1871	1870	5	Brim	711
1872	1870	5	Chemukang	362
1873	1870	5	Chemuron	623
1874	1870	5	Chemusabe	267
1875	1870	5	Kapchemogen	670
1876	1870	5	Shambabel	881
1877	1869	4	Chesower	8321
1878	1877	5	Bisho	1828
1879	1877	5	Chesower	1220
1880	1877	5	Kapteka	1112
1881	1877	5	Nyalit	1983
1882	1877	5	Siit	2178
1883	1869	4	Kabei	4523
1884	1883	5	Chemukang	631
1885	1883	5	Kabei	640
1886	1883	5	Kapseneton	2242
1887	1883	5	Rorok	1010
1888	1869	4	Kamet	4567
1889	1888	5	Borowon	902
1890	1888	5	Kamet	1246
1891	1888	5	Kapkumolon	527
1892	1888	5	Mukulei	1087
1893	1888	5	Yemitek	805
1894	1869	4	Kortek	6995
1895	1894	5	Chemwaisus	1743
1896	1894	5	Chesimat	1800
1897	1894	5	Kapkokoyo	1884
1898	1894	5	Kubobei	1568
1899	1869	4	Lwongon	2657
1900	1899	5	Aralam	677
1901	1899	5	Chekwir	358
1902	1899	5	Kapswama	320
1903	1899	5	Lwongon	268
1904	1899	5	Mokoyon	209
1905	1899	5	Ndilai	498
1906	1899	5	Tuyobei	327
1907	1869	4	Mutushet	2931
1908	1907	5	Kapkumolon	234
1909	1907	5	Kapnanunjiro	426
1910	1907	5	Kapterit	829
1911	1907	5	Kobelyo	535
1912	1907	5	Lwongon	354
1913	1907	5	Mutushet	553
1914	1869	4	Riwo	4267
1915	1914	5	Aralam	1075
1916	1914	5	Chepsoykei	828
1917	1914	5	Riwo	2364
1918	1869	4	Riwo Town Council	4787
1919	1918	5	Cheptuimet Ward	862
1920	1918	5	Kapkware Ward	2025
1921	1918	5	Kapmokon Ward	1372
1922	1918	5	Lulwo Ward	528
1923	1869	4	Tulel	5617
1924	1923	5	Burkeywo	1383
1925	1923	5	Chebinyiny	748
1926	1923	5	Kabokwo	1178
1927	1923	5	Mayak	882
1928	1923	5	Tulel	1426
1929	2	2	Bulambuli	235391
1930	1929	3	Bulambuli County	111557
1931	1930	4	Bukhalu	9497
1932	1931	5	Bukhalu	1173
1933	1931	5	Bunamaliro	1426
1934	1931	5	Bunambutye	2489
1935	1931	5	Bushiende	1225
1936	1931	5	Busiu	1355
1937	1931	5	Simu	1829
1938	1930	4	Bulambuli Town Council	5980
1939	1938	5	Administration Ward	1296
1940	1938	5	Burukuru Ward	1293
1941	1938	5	Butta Ward	1452
1942	1938	5	Bwikonge Ward	1939
1943	1930	4	Bumufuni	10240
1944	1943	5	Bumbocha	2900
1945	1943	5	Bumufuni	1754
1946	1943	5	Bumwangu	3128
1947	1943	5	Buwebele	2458
1948	1930	4	Bunalwere	7281
1949	1948	5	Bulumera	2953
1950	1948	5	Bunalwere	1528
1951	1948	5	Bunamujje	2800
1952	1930	4	Bunambutye	8307
1953	1952	5	Buluguya	2096
1954	1952	5	Bumasari	3501
1955	1952	5	Bunanganda	722
1956	1952	5	Bushangi	1988
1957	1930	4	Buwanyanga	7550
1958	1957	5	Bumusamali	1792
1959	1957	5	Busabulo	3572
1960	1957	5	Buwanyanga	2186
1961	1930	4	Buyaga Town Council	13238
1962	1961	5	Bungwanyi Ward	2230
1963	1961	5	Buyaga Central Ward	2860
1964	1961	5	Buyaga Market Ward	2736
1965	1961	5	Buyaga Ward	1794
1966	1961	5	Industrial Ward	3618
1967	1930	4	Bwikhonge	15806
1968	1967	5	Bulumela	2398
1969	1967	5	Bunalwere	3360
1970	1967	5	Buwabwala	2902
1971	1967	5	Buwekanda	2214
1972	1967	5	Bwikhonge	4932
1973	1930	4	Muyembe	13315
1974	1973	5	Bulako	1707
1975	1973	5	Bumugoya	2231
1976	1973	5	Bungwanyi	1757
1977	1973	5	Buwagogo	3103
1978	1973	5	Buyaka	4517
1979	1930	4	Nabbongo	20343
1980	1979	5	Bufukhula	2317
1981	1979	5	Bufumbula	5388
1982	1979	5	Bumasokho	4460
1983	1979	5	Bunangaka	3306
1984	1979	5	Buwakooli	2325
1985	1979	5	Nabbongo	2547
1986	1929	3	Elgon County	48836
1987	1986	4	Bulago	7236
1988	1987	5	Bugatisa	1835
1989	1987	5	Bumusamali	858
1990	1987	5	Bunasufwa	1558
1991	1987	5	Busiya	2985
1992	1986	4	Buluganya	7063
1993	1992	5	Buluganya	2304
1994	1992	5	Mabugu	1033
1995	1992	5	Masaka	812
1996	1992	5	Namunane	1645
1997	1992	5	Nataba	1269
1998	1986	4	Bumasobo	8946
1999	1998	5	Bugimwera	3223
2000	1998	5	Bumasobo	1595
2001	1998	5	Bushunu	1401
2002	1998	5	Buwokadala	2075
2003	1998	5	Nazwazwa	652
2004	1986	4	Lusha	10797
2005	2004	5	Bumwambu	3176
2006	2004	5	Bunabude	1471
2007	2004	5	Gombe	2812
2008	2004	5	Jewa	2272
2009	2004	5	Kinganda	1066
2010	1986	4	Nabiwutulu	2987
2011	2010	5	Dooba	920
2012	2010	5	Gabusogololo	661
2013	2010	5	Lugoba	618
2014	2010	5	Tunyi	788
2015	1986	4	Simu	5680
2016	2015	5	Bukibologoto	1203
2017	2015	5	Kidega	1141
2018	2015	5	Kikuyu	1015
2019	2015	5	Savannah	632
2020	2015	5	Simu	1689
2021	1986	4	Sotti	6127
2022	2021	5	Bunabahala	1740
2023	2021	5	Bunambozo	1266
2024	2021	5	Marama	528
2025	2021	5	Sotti	2593
2026	1929	3	Elgon North County	74998
2027	2026	4	Bufumbo	4518
2028	2027	5	Bufumbo	919
2029	2027	5	Buzemunwa	1156
2030	2027	5	Malungi	1309
2031	2027	5	Mbigi	1134
2032	2026	4	Buginyanya	5960
2033	2032	5	Bunatajje	955
2034	2032	5	Giduno	782
2035	2032	5	Goozi	858
2036	2032	5	Kirwali	1384
2037	2032	5	Sisiyi	898
2038	2032	5	Tabali	1083
2039	2026	4	Bulegeni	5490
2040	2039	5	Mbigi	2046
2041	2039	5	Muvule	1421
2042	2039	5	Samazi	2023
2043	2026	4	Bulegeni Town Council	11380
2044	2043	5	Bulegeni Ward	2769
2045	2043	5	Kavule Ward	4675
2046	2043	5	Magala Ward	3936
2047	2026	4	Bumugibole	12159
2048	2047	5	Bumasifwa	2201
2049	2047	5	Bumugibole	2863
2050	2047	5	Gamangweni	1575
2051	2047	5	Logoli	1757
2052	2047	5	Mayiyi	2239
2053	2047	5	Suguta	1524
2054	2026	4	Kamu	6964
2055	2054	5	Kamu	990
2056	2054	5	Kisenyi	1692
2057	2054	5	Masaba	1457
2058	2054	5	Masola	1901
2059	2054	5	Somi	924
2060	2026	4	Masira	9738
2061	2060	5	Dunga	2124
2062	2060	5	Gabugoto	2562
2063	2060	5	Ganzo	2287
2064	2060	5	Kikobero	1895
2065	2060	5	Kinyofu	870
2066	2026	4	Namisuni	6528
2067	2066	5	Gamatimbei	822
2068	2066	5	Kisekye	858
2069	2066	5	Lusaso	1101
2070	2066	5	Nambekye	902
2071	2066	5	Namezi	723
2072	2066	5	Namisuni	1180
2073	2066	5	Namudongo	942
2074	2026	4	Sisiyi	12261
2075	2074	5	Bumugusha	1912
2076	2074	5	Gibuzale	1776
2077	2074	5	Kibanda	2570
2078	2074	5	Kisubi	1228
2079	2074	5	Luzzi	1951
2080	2074	5	Mabono	2824
2081	4	2	Buliisa	167894
2082	2081	3	Buliisa County	167894
2083	2082	4	Biiso	17665
2084	2083	5	Biiso	1269
2085	2083	5	Bubwe	3735
2086	2083	5	Busingiro	7430
2087	2083	5	Nyamasoga	5231
2088	2082	4	Biiso Town Council	11638
2089	2088	5	Biiso Ward	1984
2090	2088	5	Kahemura	1771
2091	2088	5	Kampala Ward	2973
2092	2088	5	Kigungu Ward	2696
2093	2088	5	Kihuha Ward	2214
2094	2082	4	Buliisa	26018
2095	2094	5	Bugana	7221
2096	2094	5	Kakoora	5705
2097	2094	5	Kigoya	7973
2098	2094	5	Nyamitete	5119
2099	2082	4	Buliisa Town Council	14498
2100	2099	5	Central Ward	1764
2101	2099	5	Eastern Ward	3942
2102	2099	5	Northern Ward	3073
2103	2099	5	Western Ward	5719
2104	2082	4	Butiaba	15358
2105	2104	5	Bugoigo	5860
2106	2104	5	Walukuba	9498
2107	2082	4	Butiaba Town Council	8831
2108	2107	5	Eastern Ward	3556
2109	2107	5	North Ward	1534
2110	2107	5	Southern Ward	1805
2111	2107	5	Western Ward	1936
2112	2082	4	Kigwera	12034
2113	2112	5	Kigwera	2694
2114	2112	5	Kirama	5799
2115	2112	5	Kisansya	3541
2116	2082	4	Kihungya	18958
2117	2116	5	Garasoya	5035
2118	2116	5	Kagera	2844
2119	2116	5	Nyeramya	3768
2120	2116	5	Waaki	7311
2121	2082	4	Ngwedo	29278
2122	2121	5	Avogera	4975
2123	2121	5	Mubako	3857
2124	2121	5	Muvule	6258
2125	2121	5	Ngwedo	4692
2126	2121	5	Nile	9496
2127	2082	4	Wanseko Town Council	13616
2128	2127	5	Kichoke Ward	1966
2129	2127	5	Masaka Ward	1921
2130	2127	5	Ndandamire Ward	4809
2131	2127	5	Wanseko Ward	4920
2132	4	2	Bundibugyo	264778
2133	2132	3	Bughendera County	100050
2134	2133	4	Bukonzo	8003
2135	2134	5	Buhundu	1415
2136	2134	5	Bukangama	2382
2137	2134	5	Irambura	1995
2138	2134	5	Katsangirwa	1126
2139	2134	5	Kituti	1085
2140	2133	4	Burondo	7914
2141	2140	5	Burondo	2726
2142	2140	5	Karambi	2161
2143	2140	5	Mwembi	1029
2144	2140	5	Sempaya	1998
2145	2133	4	Butama-Mitunda Town Council	7602
2146	2145	5	Bundimbuga Ward	2062
2147	2145	5	Bundinjongya Ward	977
2148	2145	5	Butama Central Ward	1325
2149	2145	5	Kahimbi Ward	816
2150	2145	5	Kitengya Ward	940
2151	2145	5	Mutunda Ward	1482
2152	2133	4	Harugali	8890
2153	2152	5	Bumate	2270
2154	2152	5	Bupomboli	2114
2155	2152	5	Kasulenge	658
2156	2152	5	Kihoko	1609
2157	2152	5	Kirindi	1117
2158	2152	5	Kitsolima	453
2159	2152	5	Nyalulu	669
2160	2133	4	Kagugu	3892
2161	2160	5	Bunyamwera	850
2162	2160	5	Kaghughu	989
2163	2160	5	Kyebumba	751
2164	2160	5	Nkuranga	1302
2165	2133	4	Kasitu	4800
2166	2165	5	Kasitu	1064
2167	2165	5	Katwakali	1236
2168	2165	5	Munguni	1022
2169	2165	5	Ndalibana	1478
2170	2133	4	Mabere	6536
2171	2170	5	Mabere	1127
2172	2170	5	Mahinyi	1269
2173	2170	5	Malomba	1296
2174	2170	5	Nyakighoma	2844
2175	2133	4	Mbatya	3638
2176	2175	5	Budweya	715
2177	2175	5	Bulemba	722
2178	2175	5	Bunghuha	611
2179	2175	5	Busamba	1115
2180	2175	5	Buthungereri	475
2181	2133	4	Ndugutu	4537
2182	2181	5	Butama	1007
2183	2181	5	Kasanzi	3530
2184	2133	4	Ngamba	9329
2185	2184	5	Burambagira	971
2186	2184	5	Butolya	1580
2187	2184	5	Kikyo	2283
2188	2184	5	Ngamba	4495
2189	2133	4	Ngite	4578
2190	2189	5	Kaleyaleya	2014
2191	2189	5	Kanyangoma	637
2192	2189	5	Masule	706
2193	2189	5	Ngite	1221
2194	2133	4	Ntandi Town Council	10356
2195	2194	5	Bundimasoli Ward	3058
2196	2194	5	Kahumbu Ward	1111
2197	2194	5	Kirambi Ward	1210
2198	2194	5	Mpulya Ward	1380
2199	2194	5	Ntandi Ward	1755
2200	2194	5	Nyabugesera Ward	1842
2201	2133	4	Ntotoro	11794
2202	2201	5	Bugando	1267
2203	2201	5	Buhundu	1163
2204	2201	5	Kanyansiri	1226
2205	2201	5	Kinyankende	1482
2206	2201	5	Ntotoro	4094
2207	2201	5	Nyasoro	2562
2208	2133	4	Sindila	8181
2209	2208	5	Bunyangule	2206
2210	2208	5	Kakuka	4155
2211	2208	5	Nyankonda	1820
2212	2132	3	Bwamba County	164728
2213	2212	4	Bubandi	9440
2214	2213	5	Kanankulungo	691
2215	2213	5	Njule East	4823
2216	2213	5	Njuule	1270
2217	2213	5	Nyambaro	1918
2218	2213	5	Tombwe	738
2219	2212	4	Bubukwanga	13643
2220	2219	5	Bubukwanga	3811
2221	2219	5	Bunyamwera	1760
2222	2219	5	Humya	2729
2223	2219	5	Mampongya	3294
2224	2219	5	Saara	2049
2225	2212	4	Buganikere Town Council	7464
2226	2225	5	Buganikire Ward	1666
2227	2225	5	Bundikakemba Ward	920
2228	2225	5	Kyamaizi Ward	1555
2229	2225	5	Nkisya Ward	1025
2230	2225	5	Nyahungu Ward	936
2231	2225	5	Simbya Ward	1362
2232	2212	4	Bundibugyo Town Council	20828
2233	2232	5	Bimara Ward	2542
2234	2232	5	Bumadu Ward	1990
2235	2232	5	Bumate Ward	3196
2236	2232	5	Bundibugyo Central Ward	5235
2237	2232	5	Hamutiti Ward	4710
2238	2232	5	Kanyansimbi Ward	3155
2239	2212	4	Bundingoma	4792
2240	2239	5	Bundinamandi	1355
2241	2239	5	Bundingoma	1736
2242	2239	5	Busu	819
2243	2239	5	Nyakasoha	882
2244	2212	4	Busaru	17653
2245	2244	5	Bugombwa	2013
2246	2244	5	Bundimwendi	1480
2247	2244	5	Busaru	3998
2248	2244	5	Kinyante	2988
2249	2244	5	Kirindi	7174
2250	2212	4	Busunga Town Council	14322
2251	2250	5	Busunga Central Ward	2552
2252	2250	5	Busunga Ward	5966
2253	2250	5	Lamia Ward	2356
2254	2250	5	Mulungitanwa Ward	2171
2255	2250	5	Rutobo Ward	1277
2256	2212	4	Kaghema Town Council	9446
2257	2256	5	Bulileya Ward	2122
2258	2256	5	Kaghema Ward	1248
2259	2256	5	Kakirima Ward	2527
2260	2256	5	Kisubba Ward	1229
2261	2256	5	Lugo Ward	1213
2262	2256	5	Nakabisiri Ward	1107
2263	2212	4	Kirumya	11613
2264	2263	5	Bundibuturo	2256
2265	2263	5	Bundikeki	3223
2266	2263	5	Bundimurangya	3566
2267	2263	5	Katumba	1993
2268	2263	5	Nyankiro	575
2269	2212	4	Kisubba	13125
2270	2269	5	Bubomboli	299
2271	2269	5	Busoru	8410
2272	2269	5	Hakitara	4416
2273	2212	4	Mirambi	5998
2274	2273	5	Kuka	2086
2275	2273	5	Mirambi	934
2276	2273	5	Njanja	2978
2277	2212	4	Nyahuka Town Council	19913
2278	2277	5	Bhamba Ward	2429
2279	2277	5	Bundikahungu Ward	1264
2280	2277	5	Bundikuyali Ward	2554
2281	2277	5	Bundimulinga Ward	4986
2282	2277	5	Kahungu Ward	581
2283	2277	5	Kasiri Ward	2122
2284	2277	5	Nyahuka Ward	4927
2285	2277	5	Simbya Nkuru Ward	1050
2286	2212	4	Tokwe	16491
2287	2286	5	Buhanda	1908
2288	2286	5	Bundinyama	5274
2289	2286	5	Bunyaruta	1590
2290	2286	5	Hakitengya	3526
2291	2286	5	Mataisa	4193
2292	4	2	Bunyangabu	219012
2293	2292	3	Bunyangabu County	219012
2294	2293	4	Buheesi	10329
2295	2294	5	Irinda	2968
2296	2294	5	Kabahango	4379
2297	2294	5	Kiremezi	1653
2298	2294	5	Kyamiyaga	1329
2299	2293	4	Buheesi Town Council	19344
2300	2299	5	Kiboota Ward	8336
2301	2299	5	Rwensenene	11008
2302	2293	4	Bukara	6498
2303	2302	5	Bukara	3333
2304	2302	5	Bulyambaghu	1660
2305	2302	5	Busanda	1505
2306	2293	4	Kabonero	19297
2307	2306	5	Kabonero	11479
2308	2306	5	Nyarugongo	7818
2309	2293	4	Kakinga Town Council	13564
2310	2309	5	Kagooga Ward	4236
2311	2309	5	Kajumiro Ward	2559
2312	2309	5	Kakinga Central Ward	2520
2313	2309	5	Rubalika Ward	2258
2314	2309	5	Rugaaga Ward	1991
2315	2293	4	Kateebwa	10884
2316	2315	5	Bughumba	2885
2317	2315	5	Bunaiga	3126
2318	2315	5	Butyoka	2300
2319	2315	5	Kateebwa	2573
2320	2293	4	Kibiito	23710
2321	2320	5	Kabaale	8002
2322	2320	5	Kasunganyanja	8105
2323	2320	5	Mujunju	7603
2324	2293	4	Kibiito Town Council	15986
2325	2324	5	Central Ward	4958
2326	2324	5	East Ward	2454
2327	2324	5	South East Ward	2889
2328	2324	5	South West Ward	2111
2329	2324	5	West Ward	3574
2330	2293	4	Kisomoro	10576
2331	2330	5	Buguzi	3108
2332	2330	5	Kahondo	4328
2333	2330	5	Lyamabwa	3140
2334	2293	4	Kiyombya	17478
2335	2334	5	Kasura	3345
2336	2334	5	Kiyombya	3032
2337	2334	5	Nyakatonzi	4107
2338	2334	5	Nyamiseke	3480
2339	2334	5	Piida	3514
2340	2293	4	Kyamukube Town Council	18213
2341	2340	5	Kyamukube Ward	2323
2342	2340	5	Mitandi Ward	5023
2343	2340	5	Mutumba Ward	4801
2344	2340	5	Nsuura Ward	6066
2345	2293	4	Nyakigumba Town Council	19470
2346	2345	5	Central Ward	4798
2347	2345	5	East Ward	2634
2348	2345	5	South Ward	5559
2349	2345	5	West Ward	6479
2350	2293	4	Rubona Town Council	7464
2351	2350	5	Central Ward	3199
2352	2350	5	Southern Ward	2364
2353	2350	5	Western Ward	1901
2354	2293	4	Rwimi	7014
2355	2354	5	Kadindimo	1155
2356	2354	5	Kaina	2219
2357	2354	5	Karambi	1938
2358	2354	5	Rweihara	1702
2359	2293	4	Rwimi Town Council	19185
2360	2359	5	Nyabwina Ward	2037
2361	2359	5	Rwimi Central Ward	8408
2362	2359	5	Rwimi East Ward	4078
2363	2359	5	Rwimi West Ward	4662
2364	4	2	Bushenyi	283392
2365	2364	3	Bushenyi - Ishaka Municipality	52408
2366	2365	4	Central Division	20177
2367	2366	5	Bunyarigi Ward	2169
2368	2366	5	Central Ward	3668
2369	2366	5	Kyeitembe Ward	2735
2370	2366	5	Ruharo Ward	5045
2371	2366	5	Ryamabengwa Ward	2171
2372	2366	5	Ward II	4389
2373	2365	4	Ishaka Division	20335
2374	2373	5	Buramba Ward	2729
2375	2373	5	Kashenyi Ward	2634
2376	2373	5	Town Ward	2687
2377	2373	5	Ward III	5429
2378	2373	5	Ward IV	6856
2379	2365	4	Nyakabirizi Division	11896
2380	2379	5	Kibaare Ward	1300
2381	2379	5	Mazinga Ward	3050
2382	2379	5	Ntungamo Ward	1818
2383	2379	5	Rwenjeru Ward	2605
2384	2379	5	Ward I	3123
2385	2364	3	Igara County	230984
2386	2385	4	Bitooma Town Council	17216
2387	2386	5	Bitooma Ward	2976
2388	2386	5	Kakira	2367
2389	2386	5	Kashambya	2410
2390	2386	5	Kimuri	3350
2391	2386	5	Ngorora Ward	2528
2392	2386	5	Nyanga	3585
2393	2385	4	Bumbaire	17389
2394	2393	5	Bumbaire	5172
2395	2393	5	Kibaare	3295
2396	2393	5	Kiyaga	5012
2397	2393	5	Numba	3910
2398	2385	4	Ibaare	13602
2399	2398	5	Ibaare	3315
2400	2398	5	Kainamo	2964
2401	2398	5	Kyamugabo	3952
2402	2398	5	Ryeishe	3371
2403	2385	4	Kakanju	23648
2404	2403	5	Kabare	6060
2405	2403	5	Kakanju	4736
2406	2403	5	Katunga	5098
2407	2403	5	Kitojo	3291
2408	2403	5	Rushinya	4463
2409	2385	4	Kizinda Town Council	15522
2410	2409	5	Kigoma Ward	4780
2411	2409	5	Kizinda Ward	4547
2412	2409	5	Nyabubare Ward	6195
2413	2385	4	Kyabugimbi	12777
2414	2413	5	Bijengye	3819
2415	2413	5	Kajunju	4947
2416	2413	5	Kyeigombe	4011
2417	2385	4	Kyabugimbi Town Council	10198
2418	2417	5	Katikamwe Ward	7037
2419	2417	5	Kitwe Ward	3161
2420	2385	4	Kyamuhunga	29593
2421	2420	5	Kabingo	6515
2422	2420	5	Kakoni	2483
2423	2420	5	Kibazi	5413
2424	2420	5	Kyamuhunga	1874
2425	2420	5	Mashonga	4104
2426	2420	5	Nshumi	5455
2427	2420	5	Swazi	3749
2428	2385	4	Kyamuhunga Town Council	13785
2429	2428	5	Butare Ward	5974
2430	2428	5	Kyamuhunga Ward	4541
2431	2428	5	Mashonga Ward	3270
2432	2385	4	Kyeizooba	19304
2433	2432	5	Buyanja	3130
2434	2432	5	Bwera	2819
2435	2432	5	Kararo	5171
2436	2432	5	Kitagata	5288
2437	2432	5	Nyamiyaga	2896
2438	2385	4	Nkanga	6694
2439	2438	5	Birimbi	1722
2440	2438	5	Kabande	970
2441	2438	5	Kanyegyero	2080
2442	2438	5	Nyamirembe	1922
2443	2385	4	Nyabubare	21618
2444	2443	5	Kahungye	7332
2445	2443	5	Nyabubare	8963
2446	2443	5	Nyarugote	5323
2447	2385	4	Ruhumuro	16790
2448	2447	5	Bugaara	4478
2449	2447	5	Burungira	3151
2450	2447	5	Nyeibingo	5447
2451	2447	5	Ruhumuro	3714
2452	2385	4	Rwentuha Town Council	12848
2453	2452	5	Kitwe Ward	3708
2454	2452	5	Rutooma Ward	4214
2455	2452	5	Rwentuha Ward	4926
2456	2	2	Busia	412671
2457	2456	3	Busia Municipality	63681
2458	2457	4	Eastern Division	32150
2459	2458	5	Central Ward	8977
2460	2458	5	North C Ward	10587
2461	2458	5	North East A Ward	4589
2462	2458	5	North East B Ward	4404
2463	2458	5	South East Ward	3593
2464	2457	4	Western Division	31531
2465	2464	5	North A Ward	7726
2466	2464	5	North B Ward	10752
2467	2464	5	South West Ward	13053
2468	2456	3	Samia Bugwe Central County	97237
2469	2468	4	Buhehe	21830
2470	2469	5	Buhasaba	9152
2471	2469	5	Buhehe	8011
2472	2469	5	Bulwenge	4667
2473	2468	4	Masaba	27662
2474	2473	5	Butangasi	7933
2475	2473	5	Masaba	8919
2476	2473	5	Mbehenyi	10810
2477	2468	4	Masafu	15762
2478	2477	5	Buhatuba	5405
2479	2477	5	Kubo	4869
2480	2477	5	Mawanga	5488
2481	2468	4	Masafu Town Council	15259
2482	2481	5	Butote Ward	6469
2483	2481	5	Masafu Ward	6901
2484	2481	5	Mawanga Ward	1889
2485	2468	4	Masinya	16724
2486	2485	5	Bumunji	4901
2487	2485	5	Busikho	4892
2488	2485	5	Masinya	6931
2489	2456	3	Samia Bugwe County	251753
2490	2489	4	Bulumbi	9756
2491	2490	5	Bubango	4859
2492	2490	5	Buhobe	4897
2493	2489	4	Busime	22563
2494	2493	5	Busime	5465
2495	2493	5	Bwaniha	6645
2496	2493	5	Mundindi	6628
2497	2493	5	Rukaka	3825
2498	2489	4	Busitema	20533
2499	2498	5	Busitema	6853
2500	2498	5	Chawo	4616
2501	2498	5	Habuleke	3658
2502	2498	5	Syanyonja	5406
2503	2489	4	Buteba	35622
2504	2503	5	Abochet	6846
2505	2503	5	Amonekakinei	7438
2506	2503	5	Buteba	13040
2507	2503	5	Mawero	8298
2508	2489	4	Buyanga	22855
2509	2508	5	Bukhubalo	6172
2510	2508	5	Busibembe	4385
2511	2508	5	Buwembe	6633
2512	2508	5	Buyunda	5665
2513	2489	4	Dabani	46467
2514	2513	5	Busia	22392
2515	2513	5	Buwumba	4897
2516	2513	5	Buyengo	3054
2517	2513	5	Dabani	7260
2518	2513	5	Nangwe	8864
2519	2489	4	Lumino	8071
2520	2519	5	Budimo	2999
2521	2519	5	Hasyule	3307
2522	2519	5	Lumino	1765
2523	2489	4	Lumino-Majanji Town Council	9948
2524	2523	5	Jinja Ward	5030
2525	2523	5	Lumino Ward	4918
2526	2489	4	Lunyo	18651
2527	2526	5	Busiabala	3709
2528	2526	5	Lunyo	6657
2529	2526	5	Nalwire	4839
2530	2526	5	Nekuku	3446
2531	2489	4	Majanji	13125
2532	2531	5	Dadira	2642
2533	2531	5	Junge	2857
2534	2531	5	Majanji	1408
2535	2531	5	Majanji A	1943
2536	2531	5	Majanji B	1030
2537	2531	5	Nagabita	3245
2538	2489	4	Namungodi Town Council	10606
2539	2538	5	Buhoya Ward	3306
2540	2538	5	Buhumi Ward	2606
2541	2538	5	Bulumbi Ward	2967
2542	2538	5	Namugondi Ward	1727
2543	2489	4	Sikuda	19019
2544	2543	5	Buchicha	13274
2545	2543	5	Sikuda	5745
2546	2489	4	Tiira Town Council	14537
2547	2546	5	Abochet Ward	2498
2548	2546	5	Ajuket Ward	5719
2549	2546	5	Tiira Ward	6320
2550	2	2	Butaleja	312771
2551	2550	3	Bunyole East County	166607
2552	2551	4	Bufujja-Kachonga Town Council	13358
2553	2552	5	Bufujja Ward	2612
2554	2552	5	Bugadunya Ward	1892
2555	2552	5	Kachonga Ward	3613
2556	2552	5	Mudodo Ward	3180
2557	2552	5	Nebbo Ward	2061
2558	2551	4	Butaleja	19947
2559	2558	5	Bugosa	3274
2560	2558	5	Busibira	3875
2561	2558	5	Mabale	4217
2562	2558	5	Mulandu	2594
2563	2558	5	Nakwasi	5987
2564	2551	4	Butaleja Town Council	24726
2565	2564	5	Bunghagi Ward	7051
2566	2564	5	Butaleja Ward	3161
2567	2564	5	Hisega Ward	4059
2568	2564	5	Lujehe Ward	4150
2569	2564	5	Nanyulu Ward	3231
2570	2564	5	Sagenda Ward	3074
2571	2551	4	Himutu	18514
2572	2571	5	Kaiti	3290
2573	2571	5	Kangalaba	4880
2574	2571	5	Kanyenya	2529
2575	2571	5	Namulo	2038
2576	2571	5	Tindi	2573
2577	2571	5	Wangale	3204
2578	2551	4	Kachonga	15185
2579	2578	5	Chadongo	5191
2580	2578	5	Namajji	934
2581	2578	5	Namawa	4223
2582	2578	5	Namunasa	4837
2583	2551	4	Mazimasa	18847
2584	2583	5	Doho	4028
2585	2583	5	Kapisa	4672
2586	2583	5	Lubembe	3438
2587	2583	5	Mazimasa	2617
2588	2583	5	Muyago	4092
2589	2551	4	Nabiganda Town Council	27220
2590	2589	5	Nabiganda Ward	6306
2591	2589	5	Nakabi Ward	2544
2592	2589	5	Nampologoma Ward	6409
2593	2589	5	Namunswa Ward	5183
2594	2589	5	Namuseru Ward	2145
2595	2589	5	Nasemenye Ward	4633
2596	2551	4	Naweyo	28810
2597	2596	5	Kachekere	4566
2598	2596	5	Kachonga	3883
2599	2596	5	Kaiti	7204
2600	2596	5	Nambale	2483
2601	2596	5	Nasinyi	5780
2602	2596	5	Naweyo	4894
2603	2550	3	Bunyole West County	146164
2604	2603	4	Budumba	29322
2605	2604	5	Budumba	3921
2606	2604	5	Budusu	8191
2607	2604	5	Bunawale	6318
2608	2604	5	Bunghanga	3572
2609	2604	5	Mabale	4092
2610	2604	5	Masanghe	3228
2611	2603	4	Busaba	22309
2612	2611	5	Busaba	4570
2613	2611	5	Buwihula	1229
2614	2611	5	Mulagi	7612
2615	2611	5	Mulanga	8898
2616	2603	4	Busaba Town Council	11331
2617	2616	5	Bumwami	1910
2618	2616	5	Busaba Ward	2653
2619	2616	5	Halanga Ward	2290
2620	2616	5	Mwiha	2405
2621	2616	5	Nawinyoha Ward	2073
2622	2603	4	Busabi	23448
2623	2622	5	Bugegege	5663
2624	2622	5	Busabi	5304
2625	2622	5	Buwesa	3999
2626	2622	5	Habiga	2096
2627	2622	5	Malangha	3273
2628	2622	5	Manyamye	3113
2629	2603	4	Busolwe	17815
2630	2629	5	Bubalya	4729
2631	2629	5	Buhabeba	5323
2632	2629	5	Bunghumu	4110
2633	2629	5	Mugulu	3653
2634	2603	4	Busolwe Town Council	16371
2635	2634	5	Busolwe Central Ward	6740
2636	2634	5	Busolwe Ward	4062
2637	2634	5	Nakwiga Ward	3758
2638	2634	5	Nawasu Ward	1811
2639	2603	4	Nawanjofu	25568
2640	2639	5	Bingo	4976
2641	2639	5	Bubbinge	7447
2642	2639	5	Bugalo	7143
2643	2639	5	Masanghe	6002
2644	1	2	Butambala	146516
2645	2644	3	Butambala County	146516
2646	2645	4	Budde	21659
2647	2646	5	Budde	8300
2648	2646	5	Gwatiro	4086
2649	2646	5	Kibugga	5123
2650	2646	5	Lugala	4150
2651	2645	4	Bulo	25746
2652	2651	5	Bule	3279
2653	2651	5	Bulo	7450
2654	2651	5	Butawuka	8138
2655	2651	5	Kyerima	4025
2656	2651	5	Nakatooke	2854
2657	2645	4	Gombe Town Council	22070
2658	2657	5	Gombe Ward	11401
2659	2657	5	Kayenje Ward	6617
2660	2657	5	Ntolomwe Ward	4052
2661	2645	4	Kalamba	12218
2662	2661	5	Bweya(sseta)	6244
2663	2661	5	Kitimba	5974
2664	2645	4	Kalamba Town Council	16146
2665	2664	5	Kabasanda Ward	5682
2666	2664	5	Kirokola Ward	5733
2667	2664	5	Nsozibiri Ward	4731
2668	2645	4	Kibibi Town Council	22231
2669	2668	5	Katabira	3607
2670	2668	5	Kibibi	12408
2671	2668	5	Mabanda	2285
2672	2668	5	Mitwetwe	3931
2673	2645	4	Ngando	26446
2674	2673	5	Bukesa	5771
2675	2673	5	Butende	5503
2676	2673	5	Kasozi	9020
2677	2673	5	Lugali	6152
2678	2	2	Butebo	171433
2679	2678	3	Butebo County	171433
2680	2679	4	Butebo	8824
2681	2680	5	Kangado	2374
2682	2680	5	Kasyebai	2951
2683	2680	5	Odipanya	3499
2684	2679	4	Butebo Town Council	15635
2685	2684	5	Central Ward	2946
2686	2684	5	East Ward	2683
2687	2684	5	North Ward	3430
2688	2684	5	South Ward	2940
2689	2684	5	West Ward	3636
2690	2679	4	Kabelai	6311
2691	2690	5	Gayaza	1962
2692	2690	5	Kabelai	2785
2693	2690	5	Kayoga	1564
2694	2679	4	Kabwangasi	8175
2695	2694	5	Bulalaka	1738
2696	2694	5	Doko	1939
2697	2694	5	Kaloja	1862
2698	2694	5	Nasenyi	2636
2699	2679	4	Kabwangasi Town Council	8547
2700	2699	5	Kabwangasi Ward	2552
2701	2699	5	Kasekinyi Ward	3271
2702	2699	5	Morutome Ward	2724
2703	2679	4	Kachuru	6108
2704	2703	5	Kachuru	1913
2705	2703	5	Katubai	2010
2706	2703	5	Kinakumi	2185
2707	2679	4	Kadokolene	13336
2708	2707	5	Buchema	2936
2709	2707	5	Kadokolene	7244
2710	2707	5	Kateryo	3156
2711	2679	4	Kakoro	8680
2712	2711	5	Kadoto	2811
2713	2711	5	Kakoro	3029
2714	2711	5	Tekwana	2840
2715	2679	4	Kakoro Town Council	10972
2716	2715	5	Eastern Ward	1792
2717	2715	5	Kaitisya Ward	1714
2718	2715	5	Kasajja Ward	2590
2719	2715	5	Northern Ward	3347
2720	2715	5	Western Ward	1529
2721	2679	4	Kanginima	9188
2722	2721	5	Kasupete	2142
2723	2721	5	Kitoika Wononi	3035
2724	2721	5	Nalidi	4011
2725	2679	4	Kanginima Town Council	4796
2726	2725	5	Bupadoi Ward	1986
2727	2725	5	Kanginima Ward	1897
2728	2725	5	Katika Ward	913
2729	2679	4	Kanyum	10124
2730	2729	5	Akisim	3182
2731	2729	5	Kaduyon	2573
2732	2729	5	Kanyum	2263
2733	2729	5	Kokalen	2106
2734	2679	4	Kapunyasi	11477
2735	2734	5	Buyeda	4052
2736	2734	5	Kapunyasi	3424
2737	2734	5	Nasuleta	4001
2738	2679	4	Maizimasa	17368
2739	2738	5	Kawojan	4823
2740	2738	5	Komolo	3364
2741	2738	5	Maizimasa	4715
2742	2738	5	Sukusuku	4466
2743	2679	4	Petete	10369
2744	2743	5	Kachabali	2005
2745	2743	5	Manyowe	3529
2746	2743	5	Sidanyi	4835
2747	2679	4	Petete Town Council	13580
2748	2747	5	Kaberekeke Ward	2175
2749	2747	5	Kachocha Ward	3351
2750	2747	5	Kosinghe Ward	3667
2751	2747	5	Petete Ward	4387
2752	2679	4	Putti	7943
2753	2752	5	Buloki	1036
2754	2752	5	Nabiku	1639
2755	2752	5	Nabitende	1821
2756	2752	5	Putti	1951
2757	2752	5	Tiira	1496
2758	1	2	Buvuma	110832
2759	2758	3	Buvuma Islands County	110832
2760	2759	4	Bugaya	6334
2761	2760	5	Buwagga	1690
2762	2760	5	Buye	1401
2763	2760	5	Ndwasi	1409
2764	2760	5	Zinga	1834
2765	2759	4	Busamuzi	22264
2766	2765	5	Busamuzi	4580
2767	2765	5	Kirongo	5458
2768	2765	5	Lunyanja	4171
2769	2765	5	Mawanga	8055
2770	2759	4	Buvuma Town Council	12025
2771	2770	5	Buwanga Central	2086
2772	2770	5	Buwanga Ward	2062
2773	2770	5	Mazinga Ward	2056
2774	2770	5	Tome Ward	3325
2775	2770	5	Walwanda Ward	2496
2776	2759	4	Buwooya	16235
2777	2776	5	Bukinaalwa	3523
2778	2776	5	Buwanzi	5931
2779	2776	5	Buwooya	5090
2780	2776	5	Lingira	1691
2781	2759	4	Bweema	10095
2782	2781	5	Buziri	5412
2783	2781	5	Bweema	1399
2784	2781	5	Malijja	1614
2785	2781	5	Mpatta	1670
2786	2759	4	Lubya Town Council	8261
2787	2786	5	Kirewe	2488
2788	2786	5	Laboro	827
2789	2786	5	Lubya	3039
2790	2786	5	Namiti	1907
2791	2759	4	Lwaje	5492
2792	2791	5	Ddembe	1916
2793	2791	5	Kaserere	1875
2794	2791	5	Lukalu	1254
2795	2791	5	Lyabalume	447
2796	2759	4	Lyabaana Town Council	6708
2797	2796	5	Liibu	2457
2798	2796	5	Muwama	1200
2799	2796	5	Samba	1208
2800	2796	5	Ziru	1843
2801	2759	4	Nairambi	23418
2802	2801	5	Buwanga	3379
2803	2801	5	Lufu	4241
2804	2801	5	Lukale	5814
2805	2801	5	Magyo	3942
2806	2801	5	Namugombe	6042
2807	2	2	Buyende	403486
2808	2807	3	Budiope East County	191176
2809	2808	4	Bugaya	41881
2810	2809	5	Bugaya	5269
2811	2809	5	Busaabi	10089
2812	2809	5	Butaswa	8031
2813	2809	5	Iraapa	3928
2814	2809	5	Kigweri	4982
2815	2809	5	Namukunyu	6480
2816	2809	5	Namusikizi	3102
2817	2808	4	Gumpi	32954
2818	2817	5	Budola	2937
2819	2817	5	Gumpi	7480
2820	2817	5	Innula	5392
2821	2817	5	Kimbaya	4376
2822	2817	5	Kitukiro	6740
2823	2817	5	Nabitula	6029
2824	2808	4	Irundu	22808
2825	2824	5	Budipa	4167
2826	2824	5	Bukutula	6067
2827	2824	5	Igalaza	7366
2828	2824	5	Nkoone	5208
2829	2808	4	Irundu Town Council	15660
2830	2829	5	Bugulusi Ward	2555
2831	2829	5	Irundu Ward	7247
2832	2829	5	Kagwa Ward	3241
2833	2829	5	Kanaku Ward	2617
2834	2808	4	Kagulu	51996
2835	2834	5	Bumugoli	6921
2836	2834	5	Buyumba	5483
2837	2834	5	Iyingo	5974
2838	2834	5	Kabukye	8259
2839	2834	5	Kagulu	8114
2840	2834	5	Kirimwa	5224
2841	2834	5	Mulali	5628
2842	2834	5	Nsomba	6393
2843	2808	4	Ngandho	25877
2844	2843	5	Buyamba	3766
2845	2843	5	Gwase	5034
2846	2843	5	Kirimbi	2274
2847	2843	5	Nabisiki	4223
2848	2843	5	Ngandho	3187
2849	2843	5	Wandago	7393
2850	2807	3	Budiope West County	212310
2851	2850	4	Bukungu Town Council	17754
2852	2851	5	Bukungu Ward	6470
2853	2851	5	Kibaale Ward	6427
2854	2851	5	Kyankoole Ward	4857
2855	2850	4	Buyanja	18597
2856	2855	5	Butayunjwa	8838
2857	2855	5	Buyanja	3511
2858	2855	5	Ntaala	6248
2859	2850	4	Buyende	32625
2860	2859	5	Ikanda	6472
2861	2859	5	Kakooge	7072
2862	2859	5	Kiribairya	3525
2863	2859	5	Mango	10808
2864	2859	5	Namusita	4748
2865	2850	4	Buyende Town Council	33843
2866	2865	5	Bumyuka Ward	6214
2867	2865	5	Buyende Ward	7745
2868	2865	5	Kinawambogo Ward	8084
2869	2865	5	Makanga Ward	7528
2870	2865	5	Nakabira Ward	4272
2871	2850	4	Kidera	21014
2872	2871	5	Bulembo	5049
2873	2871	5	Kasiira	2240
2874	2871	5	Kisaikye	3911
2875	2871	5	Miseru	4313
2876	2871	5	Ndudu	5501
2877	2850	4	Kidera Town Council	20476
2878	2877	5	Itamia Ward	3435
2879	2877	5	Kabugudho Ward	4332
2880	2877	5	Kidera Ward	3926
2881	2877	5	Kitaidhumba Ward	4971
2882	2877	5	Kitete Ward	3812
2883	2850	4	Ndolwa	26315
2884	2883	5	Butongole	3666
2885	2883	5	Nabigaga	7394
2886	2883	5	Ndolwa	7763
2887	2883	5	Wesunire	7492
2888	2850	4	Nkondo	41686
2889	2888	5	Immeri	6499
2890	2888	5	Iringa East	7577
2891	2888	5	Iringa West	5984
2892	2888	5	Kigingi	4402
2893	2888	5	Kiwaba	4447
2894	2888	5	Malima	4201
2895	2888	5	Ndulya	4580
2896	2888	5	Nsekaseka	3996
2897	3	2	Dokolo	215625
2898	2897	3	Dokolo North County	120524
2899	2898	4	Adok	22221
2900	2899	5	Adok	5562
2901	2899	5	Amonoloco	2273
2902	2899	5	Amunamun	4938
2903	2899	5	Apye	4474
2904	2899	5	Bardyang	4974
2905	2898	4	Agwata Town Council	16873
2906	2905	5	Acoto Ward	1817
2907	2905	5	Amuda Central Ward	4075
2908	2905	5	Amuda Eastern Ward	2532
2909	2905	5	Kacung East Ward	1275
2910	2905	5	Kacung West Ward	1765
2911	2905	5	Mairoangwen	1923
2912	2905	5	Tetugo A	1795
2913	2905	5	Tetugo B	1691
2914	2898	4	Agwatta	9644
2915	2914	5	Adwoki	3966
2916	2914	5	Agwiciri	2375
2917	2914	5	Alyecjuk	3303
2918	2898	4	Amwoma	16313
2919	2918	5	Aburcero	3303
2920	2918	5	Adagwoo	2999
2921	2918	5	Akolodong	2927
2922	2918	5	Amwoma	3891
2923	2918	5	Iguli	3193
2924	2898	4	Bata Town Council	12457
2925	2924	5	Aderolongo South Ward	1811
2926	2924	5	Aningo Central Ward	3489
2927	2924	5	Eastern Ward	2415
2928	2924	5	Northern Ward	2425
2929	2924	5	Western Ward	2317
2930	2898	4	Batta	12468
2931	2930	5	Alapata	2167
2932	2930	5	Apenyo	594
2933	2930	5	Atabu	3517
2934	2930	5	Bardege	2382
2935	2930	5	Barlela	1440
2936	2930	5	Ocero	2368
2937	2898	4	Dokolo	18153
2938	2937	5	Abenyo	2994
2939	2937	5	Acanpii	3266
2940	2937	5	Adagmon	3130
2941	2937	5	Alenga	2511
2942	2937	5	Anangogwec	2309
2943	2937	5	Awiri	3943
2944	2898	4	Okwalongwen	12395
2945	2944	5	Abalang	1543
2946	2944	5	Adagnyeko	3120
2947	2944	5	Akwanga	2163
2948	2944	5	Aluti	2903
2949	2944	5	Okwalongwen	2666
2950	2897	3	Dokolo South County	95101
2951	2950	4	Adeknino	19504
2952	2951	5	Adeknino	4094
2953	2951	5	Adwong-Owor	3611
2954	2951	5	Ajiba	3587
2955	2951	5	Aridi	3523
2956	2951	5	Awelo	4689
2957	2950	4	Dokolo Town Council	24697
2958	2957	5	Central Ward	8624
2959	2957	5	Eastern Ward	4994
2960	2957	5	Northern Ward	2471
2961	2957	5	Southern Ward	2303
2962	2957	5	Western Ward	6305
2963	2950	4	Kangai	10726
2964	2963	5	Adwila	2341
2965	2963	5	Angwenya	2775
2966	2963	5	Ayuni	1295
2967	2963	5	Chwagere	4315
2968	2950	4	Kangai Town Council	8909
2969	2968	5	Akurolango Ward	2270
2970	2968	5	Angai Ward	2453
2971	2968	5	Angwenya Ward	1708
2972	2968	5	Ayuni Ward	2478
2973	2950	4	Kwera	15333
2974	2973	5	Agoga	3557
2975	2973	5	Anwangi	2388
2976	2973	5	Apenyang	3492
2977	2973	5	Otoro	2362
2978	2973	5	Oyeng-Opere	3534
2979	2950	4	Okwongodul	15932
2980	2979	5	Ageni	2378
2981	2979	5	Aneralibi	3830
2982	2979	5	Anyacoto	2913
2983	2979	5	Apenyoweo	3732
2984	2979	5	Okwongodul	3079
2985	4	2	Fort Portal City	137549
2986	2985	3	Fort Portal Central Division	66783
2987	2986	4	Fort Portal Central Division	66783
2988	2987	5	Bazaar Ward	7588
2989	2987	5	Bukwali Ward	6481
2990	2987	5	Ibaale Ward	2343
2991	2987	5	Kagote Ward	4801
2992	2987	5	Kasusu Ward	5565
2993	2987	5	Kibimba Ward	4586
2994	2987	5	Kijanju Ward	4805
2995	2987	5	Kitumba Ward	6432
2996	2987	5	Njara Ward	6851
2997	2987	5	Nyabukara Ward	5338
2998	2987	5	Nyakagongo Ward	5702
2999	2987	5	Rwengoma Ward	6291
3000	2985	3	Fort Portal North Division	70766
3001	3000	4	Fort Portal North Division	70766
3002	3001	5	Butebe Ward	18796
3003	3001	5	Gweri Ward	5341
3004	3001	5	Ibonde Ward	4257
3005	3001	5	Karago Ward	4923
3006	3001	5	Karambi Ward	11865
3007	3001	5	Kazingo Ward	3316
3008	3001	5	Kiguma Ward	1789
3009	3001	5	Kitaka Ward	3583
3010	3001	5	Kitarasa Ward	5426
3011	3001	5	Mandako Ward	2444
3012	3001	5	Nyakitojo Ward	1436
3013	3001	5	Rubingo Ward	5544
3014	3001	5	Rwenkuba Ward	2046
3015	1	2	Gomba	199120
3016	3015	3	Gomba East County	90544
3017	3016	4	Kanoni Town Council	17570
3018	3017	5	Kanoni Ward	10253
3019	3017	5	Koome Ward	4284
3020	3017	5	Wanjeyo Ward	3033
3021	3016	4	Kyegonza	36179
3022	3021	5	Bukundugulu	2250
3023	3021	5	Kisoga	4526
3024	3021	5	Malele	3361
3025	3021	5	Mamba	6614
3026	3021	5	Mpunge	3763
3027	3021	5	Nakijju	4242
3028	3021	5	Namabeya	3646
3029	3021	5	Nsambwe	4902
3030	3021	5	Saali	2875
3031	3016	4	Mpenja	27334
3032	3031	5	Golola	4749
3033	3031	5	Kakomo	2169
3034	3031	5	Kanziira	3066
3035	3031	5	Kiriri	4511
3036	3031	5	Maseruka	2513
3037	3031	5	Mpogo	3895
3038	3031	5	Ngeribalya	3122
3039	3031	5	Nkoma	3309
3040	3016	4	Ttaba-Bbinzi	9461
3041	3040	5	Katikampanda	1372
3042	3040	5	Kubamitwe	2116
3043	3040	5	Ngomanene	2705
3044	3040	5	Ttaba-Bbinzi	3268
3045	3015	3	Gomba West County	108576
3046	3045	4	Kabulasoke	43694
3047	3046	5	Bukandula	8086
3048	3046	5	Bulwadda	8212
3049	3046	5	Butiti	6518
3050	3046	5	Kalwanga	7911
3051	3046	5	Lugaaga	4977
3052	3046	5	Matongo	3933
3053	3046	5	Mawuki	4057
3054	3045	4	Kifampa	17253
3055	3054	5	Kawuula	5483
3056	3054	5	Kifampa	4789
3057	3054	5	Kisozi	3907
3058	3054	5	Mityegonga	3074
3059	3045	4	Kyayi	14263
3060	3059	5	Bugula	3481
3061	3059	5	Buyanja	3136
3062	3059	5	Kalyamawolu	1304
3063	3059	5	Kasambya	2193
3064	3059	5	Kyayi	4149
3065	3045	4	Maddu	20749
3066	3065	5	Ddegeya	6514
3067	3065	5	Kigezi	5467
3068	3065	5	Kigumba	3164
3069	3065	5	Kitwe	3151
3070	3065	5	Kyabagamba	2453
3071	3045	4	Maddu Town Council	12617
3072	3071	5	Maddu Ward A	5681
3073	3071	5	Maddu Ward B	2063
3074	3071	5	Maddu Ward C	2563
3075	3071	5	Ntalagi Ward	2310
3076	3	2	Gulu	135373
3077	3076	3	Aswa County	135373
3078	3077	4	Awach	16864
3079	3078	5	Burcoro	1897
3080	3078	5	Gwengdiya	2151
3081	3078	5	Paduny	9030
3082	3078	5	Pageya	1643
3083	3078	5	Pugwinyi	2143
3084	3077	4	Bungatira	12422
3085	3084	5	Atiabar Central	1143
3086	3084	5	Atiabar North	3974
3087	3084	5	Atiabar South	1524
3088	3084	5	Lukome	3211
3089	3084	5	Punena	2570
3090	3077	4	Omel	12313
3091	3090	5	Apem	2868
3092	3090	5	Bulkur	2147
3093	3090	5	Kuru	2493
3094	3090	5	Lakwela	2742
3095	3090	5	Ogwari	2063
3096	3077	4	Owalo	7783
3097	3096	5	Kiteny	2919
3098	3096	5	Lugore	2567
3099	3096	5	Pokogali	2297
3100	3077	4	Owoo	12468
3101	3100	5	Kulukeno	2497
3102	3100	5	Pabwo	1479
3103	3100	5	Pugwinyi	8492
3104	3077	4	Paibona	7915
3105	3104	5	Acutomer Gem	1519
3106	3104	5	Ayweri	1862
3107	3104	5	Bolipii	2097
3108	3104	5	Tugu	2437
3109	3077	4	Paicho	26873
3110	3109	5	Atoo Hill	5557
3111	3109	5	Boke	2888
3112	3109	5	Kal Alii B	1459
3113	3109	5	Kal-Alii	3400
3114	3109	5	Kal-Umu	2578
3115	3109	5	Laban	4029
3116	3109	5	Laminto	2373
3117	3109	5	Pagik	4589
3118	3077	4	Palaro	11523
3119	3118	5	Awich	2330
3120	3118	5	Labworomor	3941
3121	3118	5	Mede	1289
3122	3118	5	Ocetoaka	1106
3123	3118	5	Ongedo	1469
3124	3118	5	Oroko	1388
3125	3077	4	Patiko	12952
3126	3125	5	Kal	6518
3127	3125	5	Pawel	6434
3128	3077	4	Pukony	5044
3129	3128	5	Laban	1503
3130	3128	5	Oguru	1046
3131	3128	5	Otege	1964
3132	3128	5	Wilul	531
3133	3077	4	Unyama	9216
3134	3133	5	Angaya	4304
3135	3133	5	Oding	4912
3136	3	2	Gulu City	233271
3137	3136	3	Bardege-Layibi Division	93848
3138	3137	4	Bardege-Layibi Division	93848
3139	3138	5	Alokolum Ward	5830
3140	3138	5	Bar-Dege Ward	5647
3141	3138	5	For God Ward	5910
3142	3138	5	Kanyagoga Ward	10044
3143	3138	5	Kasubi Ward	15281
3144	3138	5	Kirombe Ward	8923
3145	3138	5	Kweyo Ward	3356
3146	3138	5	Library Ward	5396
3147	3138	5	Oitino Ward	4025
3148	3138	5	Paminano Ward	1842
3149	3138	5	Patuda-Abuga Ward	2832
3150	3138	5	Patuda-Layibi Ward	8569
3151	3138	5	Techo Ward	16193
3152	3136	3	Laroo-Pece Division	139423
3153	3152	4	Laroo-Pece Division	139423
3154	3153	5	Acoyo Ward	4470
3155	3153	5	Agonga Ward	3891
3156	3153	5	Agwee Ward	7946
3157	3153	5	Iriaga Ward	10098
3158	3153	5	Kal Ward	6280
3159	3153	5	Labourline Ward	2676
3160	3153	5	Laliya Ward	6884
3161	3153	5	Lawiyadul Ward	7191
3162	3153	5	Obiya Laroo Ward	3827
3163	3153	5	Pageya Laroo Ward	5434
3164	3153	5	Pageya Ward	7582
3165	3153	5	Pakwelo Ward	5920
3166	3153	5	Pawel Ward	10597
3167	3153	5	Pece Prisons Ward	10795
3168	3153	5	Queens Avenue Ward	2189
3169	3153	5	Tegwana Ward	21678
3170	3153	5	Twon Okun Ward	2496
3171	3153	5	Unyama Ward	7894
3172	3153	5	Vanguard Ward	11575
3173	4	2	Hoima	257544
3174	3173	3	Bugahya County	169051
3175	3174	4	Buhanika	20367
3176	3175	5	Butema	3856
3177	3175	5	Katereiga	3768
3178	3175	5	Kikerege	3104
3179	3175	5	Kitonya	2482
3180	3175	5	Kitorogya	2331
3181	3175	5	Kyohairwe	4826
3182	3174	4	Bulindi Town Council	10492
3183	3182	5	Central Ward	3125
3184	3182	5	Kakindo Ward	3373
3185	3182	5	Kibaire Ward	3994
3186	3174	4	Buraru	20198
3187	3186	5	Buraru	6391
3188	3186	5	Busanga	2635
3189	3186	5	Buyanja	4910
3190	3186	5	Kyabanati	6262
3191	3174	4	Buseruka	27724
3192	3191	5	Buseruka	5958
3193	3191	5	Nyakabingo	9952
3194	3191	5	Rwentale	7604
3195	3191	5	Tonya	4210
3196	3174	4	Kabaale	28322
3197	3196	5	Kabaale	3831
3198	3196	5	Kigaaga	8891
3199	3196	5	Mbegu	7562
3200	3196	5	Nzorobi	8038
3201	3174	4	Kitoba	41632
3202	3201	5	Birungu	9383
3203	3201	5	Budaka	4880
3204	3201	5	Bulyango	8095
3205	3201	5	Kibanjwa	7466
3206	3201	5	Kiragura	5622
3207	3201	5	Kiryangobe	6186
3208	3174	4	Kyabigambire	20316
3209	3208	5	Kibugubya	11540
3210	3208	5	Kisabagwa	8776
3211	3173	3	Kigorobya County	88493
3212	3211	4	Bombo	22901
3213	3212	5	Buhirigi	6641
3214	3212	5	Bwikya	2475
3215	3212	5	Hanga	6180
3216	3212	5	Kanyiira	2659
3217	3212	5	Marongo	4946
3218	3211	4	Kapaapi	18500
3219	3218	5	Kapaapi	8113
3220	3218	5	Kibengeya	3519
3221	3218	5	Kyamukwenda	6868
3222	3211	4	Kiganja	16009
3223	3222	5	Kibiro	8605
3224	3222	5	Kiganja	2229
3225	3222	5	Kiryandongo	2445
3226	3222	5	Kyeramya	2730
3227	3211	4	Kigorobya	3671
3228	3227	5	Hanga	1563
3229	3227	5	Kyabisagazi	2108
3230	3211	4	Kigorobya Town Council	7719
3231	3230	5	North East Ward	1169
3232	3230	5	Northern Ward	1666
3233	3230	5	South East Ward	3519
3234	3230	5	South West Ward	1365
3235	3211	4	Kijongo	5731
3236	3235	5	Karungu	1668
3237	3235	5	Kigomba	1952
3238	3235	5	Kijongo	2111
3239	3211	4	Kisukuma	13962
3240	3239	5	Bukona	2765
3241	3239	5	Haibale	3211
3242	3239	5	Kabatindule	2393
3243	3239	5	Kisukuma	3126
3244	3239	5	Ngaragi	2467
3245	4	2	Hoima City	143304
3246	3245	3	Hoima East Division	59345
3247	3246	4	Hoima East Division	59345
3248	3247	5	Bwikya Ward	15296
3249	3247	5	Central Ward	6500
3250	3247	5	Kicwamba Ward	6636
3251	3247	5	Kyentale Ward	6363
3252	3247	5	Northern Ward	4991
3253	3247	5	Nyakambugu Ward	4600
3254	3247	5	Southern Ward	14959
3255	3245	3	Hoima West Division	83959
3256	3255	4	Hoima West Division	83959
3257	3256	5	Bujuura Ward	1908
3258	3256	5	Karongo Ward	3079
3259	3256	5	Kasingo Ward	12799
3260	3256	5	Kibingo Ward	8419
3261	3256	5	Kiduuma Ward	5694
3262	3256	5	Kihomboza Ward	18136
3263	3256	5	Kihukya Ward	7944
3264	3256	5	Kyesiiga Ward	8643
3265	3256	5	Western Ward	17337
3266	4	2	Ibanda	309466
3267	3266	3	Ibanda County	183378
3268	3267	4	Igorora Town Council	7910
3269	3268	5	Igorora Ward	5277
3270	3268	5	Ngango Ward	2633
3271	3267	4	Ishongororo	13332
3272	3271	5	Kashozi	5432
3273	3271	5	Mushunga	4070
3274	3271	5	Muziza	3830
3275	3267	4	Ishongororo Town Council	26426
3276	3275	5	Kakinga Ward	12006
3277	3275	5	Nyantsimbo Ward	14420
3278	3267	4	Kanyarugiri Town Council	4000
3279	3278	5	Kanyarugiri Ward	2495
3280	3278	5	Rwamagundu Ward	1505
3281	3267	4	Keihangara	14057
3282	3281	5	Keihangara	4094
3283	3281	5	Rugaaga	5728
3284	3281	5	Rwenshambya	4235
3285	3267	4	Kicuzi	20124
3286	3285	5	Irimya	7119
3287	3285	5	Kanywambogo	5081
3288	3285	5	Kicuzi	7924
3289	3267	4	Kijongo	15830
3290	3289	5	Birongo	5452
3291	3289	5	Kamwiri	2312
3292	3289	5	Kijongo	4315
3293	3289	5	Rwambu	3751
3294	3267	4	Kikyenkye	14513
3295	3294	5	Irwaniro	2908
3296	3294	5	Kihani	5214
3297	3294	5	Rwengwe	6391
3298	3267	4	Nyabuhikye	4089
3299	3298	5	Bwahwa	946
3300	3298	5	Kyentama	1374
3301	3298	5	Rugoba	1769
3302	3267	4	Nyamarebe	21205
3303	3302	5	Bihanga	6554
3304	3302	5	Kyengando	7889
3305	3302	5	Nyakabungo	4173
3306	3302	5	Ryabiju	2589
3307	3267	4	Rukiri	30288
3308	3307	5	Bwenda	5587
3309	3307	5	Katembe	5680
3310	3307	5	Kigunga	3513
3311	3307	5	Mabona	5012
3312	3307	5	Mpasha	5626
3313	3307	5	Nyarukiika	4870
3314	3267	4	Rushango Town Council	7536
3315	3314	5	Itabyama Ward	1776
3316	3314	5	Rushango A Ward	3206
3317	3314	5	Rushango B Ward	2554
3318	3267	4	Rwenkobwa Town Council	4068
3319	3318	5	Karemba Ward	1971
3320	3318	5	Mirambi Ward	2097
3321	3266	3	Ibanda Municipality	126088
3322	3321	4	Bisheshe Division	39962
3323	3322	5	Bugarama Ward	10776
3324	3322	5	Kabaare Ward	7179
3325	3322	5	Kakatsi Ward	4337
3326	3322	5	Karangara Ward	8380
3327	3322	5	Kigarama Ward	4503
3328	3322	5	Rugazi Ward	4787
3329	3321	4	Bufunda Division	45262
3330	3329	5	Bufunda Ward	16080
3331	3329	5	Katongore Ward	4184
3332	3329	5	Kayenje Ward	7453
3333	3329	5	Kikoni Ward	1838
3334	3329	5	Nsasi Ward	3160
3335	3329	5	Nyamirima Ward	7711
3336	3329	5	Ruyonza Ward	2356
3337	3329	5	Rwobuzizi Ward	2480
3338	3321	4	Kagongo Division	40864
3339	3338	5	Kagongo Ward	6717
3340	3338	5	Kanyansheko Ward	3595
3341	3338	5	Kashangura Ward	6710
3342	3338	5	Kyaruhanga Ward	10996
3343	3338	5	Kyeikucu Ward	5498
3344	3338	5	Nyakatokye Ward	4785
3345	3338	5	Rwenshuri Ward	2563
3346	2	2	Iganga	426958
3347	3346	3	Iganga Municipality	56381
3348	3347	4	Central Division	35287
3349	3348	5	Buligo Ward	7705
3350	3348	5	Kasokoso Ward	2043
3351	3348	5	Nabidongha Prison Ward	7693
3352	3348	5	Nabidongha Ward	5178
3353	3348	5	Nakavule Ward	7447
3354	3348	5	Walugogo Ward	5221
3355	3347	4	Northern Division	21094
3356	3355	5	Bugumba Ward	4538
3357	3355	5	Igamba Ward	7269
3358	3355	5	Mutukula Ward	4837
3359	3355	5	Nkatu Ward	1996
3360	3355	5	Nkono Ward	2454
3361	3346	3	Kigulu County	370577
3362	3361	4	Bulamagi	37020
3363	3362	5	Bukoyo	9184
3364	3362	5	Bulamagi	4248
3365	3362	5	Bulowooza	7723
3366	3362	5	Bwanalira	6653
3367	3362	5	Iwawu	9212
3368	3361	4	Kidaago	28775
3369	3368	5	Kazigo	3950
3370	3368	5	Kidaago	3205
3371	3368	5	Nabitende	15214
3372	3368	5	Naibiri	6406
3373	3361	4	Nabitende	35354
3374	3373	5	Bugono	3320
3375	3373	5	Itanda	7370
3376	3373	5	Kabira-Ituba	8781
3377	3373	5	Kasambika	5201
3378	3373	5	Nabitende	5778
3379	3373	5	Naluko	4904
3380	3361	4	Nakalama	73936
3381	3380	5	Bukaye	24533
3382	3380	5	Bukoona	10126
3383	3380	5	Buseyi	20155
3384	3380	5	Nakalama	19122
3385	3361	4	Nakigo	54169
3386	3385	5	Bulubandi	24695
3387	3385	5	Bunyama	5174
3388	3385	5	Busowoobi	10071
3389	3385	5	Kabira	9279
3390	3385	5	Wairama	4950
3391	3361	4	Nambale	28605
3392	3391	5	Mwira	6788
3393	3391	5	Nambale	8831
3394	3391	5	Nasuti	12986
3395	3361	4	Namungalwe Town Council	44990
3396	3395	5	Bulumwaki Ward	5270
3397	3395	5	Mwendanfuko Ward	4411
3398	3395	5	Namungalwe Ward	15362
3399	3395	5	Namunkanaga Ward	4374
3400	3395	5	Namunkesu Ward	7715
3401	3395	5	Namunsaala Ward	3402
3402	3395	5	Nawansega Ward	4456
3403	3361	4	Nawandala	37314
3404	3403	5	Bugongo	13768
3405	3403	5	Kiwanyi	4945
3406	3403	5	Kyendabawala	6101
3407	3403	5	Namusiisi	6739
3408	3403	5	Nawangaiza	5761
3409	3361	4	Nawanyingi	30414
3410	3409	5	Bunyiro	6097
3411	3409	5	Magogo	15490
3412	3409	5	Nawanyingi	8827
3413	4	2	Isingiro	635077
3414	3413	3	Bukanga County	90165
3415	3414	4	Bugango Town Council	17079
3416	3415	5	Kasharira	4459
3417	3415	5	Kikokwa Ward	2418
3418	3415	5	Kishunju Ward	2160
3419	3415	5	Kyabazibwe Ward	1475
3420	3415	5	Murema	4019
3421	3415	5	Nshororo Ward	2548
3422	3414	4	Endiinzi Town Council	17623
3423	3422	5	Endiinzi A Ward	7541
3424	3422	5	Endiinzi B Ward	3879
3425	3422	5	Kamaaya Ward	1963
3426	3422	5	Kikoba Ward	1887
3427	3422	5	Nyabyondo	2353
3428	3414	4	Endinzi	13191
3429	3428	5	Buhunga	3207
3430	3428	5	Busheka	3339
3431	3428	5	Kashoga	1135
3432	3428	5	Rwambaga	5510
3433	3414	4	Mbaare	32969
3434	3433	5	Burigi	3398
3435	3433	5	Kihanda	6438
3436	3433	5	Kyabahesi	9285
3437	3433	5	Nshororo	2187
3438	3433	5	Nyamarungi	6876
3439	3433	5	Ruteete	4785
3440	3414	4	Rwanjogyera	9303
3441	3440	5	Mpikye	1169
3442	3440	5	Rukungiri	1513
3443	3440	5	Rutunga	2079
3444	3440	5	Rwakasasira	1678
3445	3440	5	Rwanjogyera	2864
3446	3413	3	Bukanga North County	225840
3447	3446	4	Kakamba	10786
3448	3447	5	Burumba	1258
3449	3447	5	Kakamba	3468
3450	3447	5	Kashenyi	1972
3451	3447	5	Ntenga	1293
3452	3447	5	Rurongo	2795
3453	3446	4	Kashumba	20330
3454	3453	5	Kankingi	6078
3455	3453	5	Kashumba	4043
3456	3453	5	Kigaragara	5734
3457	3453	5	Rushwa	4475
3458	3446	4	Nakivale Basecamp Rwc III	68645
3459	3458	5	Basecamp Rcw II	13108
3460	3458	5	Kabanzana Rwc II	12301
3461	3458	5	Kashojwa Rwc II	20396
3462	3458	5	Kigali Rwc II	4672
3463	3458	5	Kiretwa Zone Rwc II	2179
3464	3458	5	Kityaza Rcw II	4643
3465	3458	5	Nyarugugu Rwc II	11346
3466	3446	4	Nakivale-Juru Rwc III	18817
3467	3466	5	Isanja Rwc II	2422
3468	3466	5	Kabahinda Rcw II	2168
3469	3466	5	Kabahinda-Juru Rcw II	2991
3470	3466	5	Kankingi Rcw II	7923
3471	3466	5	Kityaza Rcw II	1421
3472	3466	5	Ngarama Rwc II	1892
3473	3446	4	Nakivale-Rubondo Rwc III	21057
3474	3473	5	Kisura Zone	2377
3475	3473	5	Nyakagando Rwc II	5049
3476	3473	5	Rubondo Rwc II	11837
3477	3473	5	Ruhooko Zone	1794
3478	3446	4	Ngarama	30071
3479	3478	5	Burungamo	8897
3480	3478	5	Kabaare	6862
3481	3478	5	Kagaaga	4980
3482	3478	5	Ngarama	9332
3483	3446	4	Rugaaga	20519
3484	3483	5	Kashojwa	2938
3485	3483	5	Kyarubambura	5859
3486	3483	5	Nyabubaare	5585
3487	3483	5	Rwangabo	6137
3488	3446	4	Rugaaga Town Council	16421
3489	3488	5	Kabaare Ward	5138
3490	3488	5	Kiryaburo Ward	5066
3491	3488	5	Kyampango Ward	6217
3492	3446	4	Rushasha	19194
3493	3492	5	Ihunga	3223
3494	3492	5	Mirambiro	5548
3495	3492	5	Rushasha	5295
3496	3492	5	Rwantaha	5128
3497	3413	3	Isingiro County	248654
3498	3497	4	Birere	26283
3499	3498	5	Kahenda	4141
3500	3498	5	Kasaana	4586
3501	3498	5	Kikokwa	3928
3502	3498	5	Kishuro	4573
3503	3498	5	Kyera	9055
3504	3497	4	Isingiro Town Council	39957
3505	3504	5	Kaharo Ward	7821
3506	3504	5	Kamuri Ward	10053
3507	3504	5	Kyabishaho Ward	8168
3508	3504	5	Mabona Ward	6711
3509	3504	5	Rwekubo Ward	7204
3510	3497	4	Kaberebere Town Council	9581
3511	3510	5	Kaberebere East Ward	4765
3512	3510	5	Kaberebere South Ward	2881
3513	3510	5	Kaberebere West Ward	1935
3514	3497	4	Kabingo	12677
3515	3514	5	Bitooma	1383
3516	3514	5	Kagogo	3075
3517	3514	5	Katembe	1349
3518	3514	5	Kyarugaaju	3962
3519	3514	5	Kyeirumba	2908
3520	3497	4	Kagarama	13360
3521	3520	5	Kagarama	3162
3522	3520	5	Kitura	1854
3523	3520	5	Kyabinunga	4253
3524	3520	5	Nyakigyera	4091
3525	3497	4	Kamubeizi	8625
3526	3525	5	Kabeshekyere	2924
3527	3525	5	Kamubeizi	3306
3528	3525	5	Kyarugoza	2395
3529	3497	4	Kamubeizi Town Council	12448
3530	3529	5	Burambira Ward	2835
3531	3529	5	Kamubeizi Ward	2844
3532	3529	5	Katanzi Ward	2806
3533	3529	5	Kibaale Ward	1837
3534	3529	5	Kisharira Ward	2126
3535	3497	4	Kikagate	18030
3536	3535	5	Kyezimbire	4132
3537	3535	5	Ntundu	2678
3538	3535	5	Nyabushenyi	5003
3539	3535	5	Rwamwijuka	6217
3540	3497	4	Kikagate Town Council	11481
3541	3540	5	Katanga Ward	2658
3542	3540	5	Kikagate Boarder Ward	2116
3543	3540	5	Kikagate Ward	3192
3544	3540	5	Kitezo Ward	3515
3545	3497	4	Masha	29776
3546	3545	5	Kabaare	9087
3547	3545	5	Nyakakoni	2833
3548	3545	5	Nyamitsindo	2483
3549	3545	5	Nyarubungo	4790
3550	3545	5	Rukuuba	3221
3551	3545	5	Rumuri	1710
3552	3545	5	Rwenshebashebe	5652
3553	3497	4	Ntungu	7496
3554	3553	5	Ishingisha	2283
3555	3553	5	Kimbugu	919
3556	3553	5	Ntungu	1976
3557	3553	5	Omukakoreijo	2318
3558	3497	4	Nyakitunda	19962
3559	3558	5	Bugongi	7033
3560	3558	5	Kihiihi	6967
3561	3558	5	Nyakarambi	5962
3562	3497	4	Nyamuyanja	16570
3563	3562	5	Ibumba	4048
3564	3562	5	Katanoga	3812
3565	3562	5	Kigyendwa	3160
3566	3562	5	Nyamuyanja	5550
3567	3497	4	Ruyanga	18284
3568	3567	5	Kajaho	6651
3569	3567	5	Katojo	3763
3570	3567	5	Nshungezi	3560
3571	3567	5	Rutooma	1701
3572	3567	5	Ruyanga	2609
3573	3497	4	Rwetango	4124
3574	3573	5	Rwenfunjo	929
3575	3573	5	Rwenyanga	1706
3576	3573	5	Rwetango	1489
3577	3413	3	Isingiro West County	70418
3578	3577	4	Kabuyanda	22927
3579	3578	5	Kabugu	7888
3580	3578	5	Kagara	3870
3581	3578	5	Kanywamaizi	5798
3582	3578	5	Rwakakwenda	5371
3583	3577	4	Kabuyanda Town Council	17911
3584	3583	5	Central Ward	6323
3585	3583	5	Iryango	4969
3586	3583	5	Kisyoro Ward	3437
3587	3583	5	Northern Ward	3182
3588	3577	4	Ruborogota	19096
3589	3588	5	Karama	4455
3590	3588	5	Kyamusoni	5967
3591	3588	5	Nshenyi	3051
3592	3588	5	Ruborogota	3550
3593	3588	5	Rwangunga	2073
3594	3577	4	Ruhiira Town Council	10484
3595	3594	5	Migyera Ward	2659
3596	3594	5	Nyakamuri Ward	2666
3597	3594	5	Ruhiira Northern Ward	3035
3598	3594	5	Ruhira Central Ward	2124
3599	2	2	Jinja	280905
3600	3599	3	Butembe County	86869
3601	3600	4	Busedde	44015
3602	3601	5	Bugobya	8519
3603	3601	5	Itakaibolu	7684
3604	3601	5	Kisasi	10813
3605	3601	5	Nabitambala	9390
3606	3601	5	Nalinaibi	7609
3607	3600	4	Kakira Town Council	42854
3608	3607	5	Chico Ward	2590
3609	3607	5	Kabyaza Ward	4052
3610	3607	5	Kakira Ward	3888
3611	3607	5	Karongo Ward	3789
3612	3607	5	Mawoito Ward	6749
3613	3607	5	Mwiri Ward	7547
3614	3607	5	Polota Ward	6748
3615	3607	5	Wairaka Ward	7491
3616	3599	3	Kagoma County	63836
3617	3616	4	Butagaya	40928
3618	3617	5	Budima	9130
3619	3617	5	Nakakulwe (kisozi)	11341
3620	3617	5	Nawampanda	10221
3621	3617	5	Wansiimba	10236
3622	3616	4	Namagera Town Council	22908
3623	3622	5	Lubani Ward	4782
3624	3622	5	Mpumwire Ward	4931
3625	3622	5	Namagera Ward	9244
3626	3622	5	Namwendwa Ward	3951
3627	3599	3	Kagoma North County	130200
3628	3627	4	Buwenge	60693
3629	3628	5	Buweera	10101
3630	3628	5	Kagoma	18525
3631	3628	5	Kaiira	9473
3632	3628	5	Kitanaba	7541
3633	3628	5	Magamaga	15053
3634	3627	4	Buwenge Town Council	30377
3635	3634	5	Kagaire Ward	6871
3636	3634	5	Kalitunsi Ward	4819
3637	3634	5	Kamwani Ward	6563
3638	3634	5	Kasalina Ward	12124
3639	3627	4	Buyengo Town Council	39130
3640	3639	5	Bulugo Ward	7422
3641	3639	5	Butamira Ward	7591
3642	3639	5	Buwabuzi Ward	10210
3643	3639	5	Iziru Ward	13907
3644	2	2	Jinja City	279184
3645	3644	3	Jinja North Division	211284
3646	3645	4	Jinja North Division	211284
3647	3646	5	Budhumbuli East Ward	6124
3648	3646	5	Budhumbuli West Ward	7595
3649	3646	5	Buwagi (kakyomya) Ward	13699
3650	3646	5	Buwekula Ward	17912
3651	3646	5	Buwenda Tc Ward	19031
3652	3646	5	Ivunamba Ward	10261
3653	3646	5	Katende Ward	8280
3654	3646	5	Kibibi Ward	8830
3655	3646	5	Mafubira Ward	33551
3656	3646	5	Nakanyonyi Ward	8051
3657	3646	5	Namizi Ward	12800
3658	3646	5	Namulesa Ward	21913
3659	3646	5	Nawangoma Ward	9306
3660	3646	5	Wanyama Ward	8369
3661	3646	5	Wanyange Ward	25562
3662	3644	3	Jinja South Division	67900
3663	3662	4	Jinja South Division	67900
3664	3663	5	Central Jinja East Ward	4547
3665	3663	5	Central Jinja West Ward	2088
3666	3663	5	Kimaka Ward	3633
3667	3663	5	Lubaga Ward	7136
3668	3663	5	Maggwa Ward	4219
3669	3663	5	Masese Ward	21925
3670	3663	5	Mpumudde Ward	3866
3671	3663	5	Nalufenya Ward	1643
3672	3663	5	Old Boma Ward	2705
3673	3663	5	Walukuba East Ward	6854
3674	3663	5	Walukuba West Ward	9284
3675	3	2	Kaabong	264631
3676	3675	3	Dodoth East County	137241
3677	3676	4	Kaabong Town Council	25657
3678	3677	5	Biafra Ward	4573
3679	3677	5	Campswahili Ward	3348
3680	3677	5	Central Ward	4463
3681	3677	5	Kapilan Bar East Ward	3117
3682	3677	5	Kapilan Bar West Ward	2353
3683	3677	5	Komuria East Ward	1949
3684	3677	5	Komuria West Ward	2691
3685	3677	5	Loputuk Ward	581
3686	3677	5	Pajar Ward	2582
3687	3676	4	Kaabong West	19583
3688	3687	5	Kaabong	4306
3689	3687	5	Lokerui	3576
3690	3687	5	Lokerui Centre	2944
3691	3687	5	Lomeris	4278
3692	3687	5	Lomoruitae	4479
3693	3676	4	Kakamar	15945
3694	3693	5	Kakamar	2105
3695	3693	5	Kite-Lore	2617
3696	3693	5	Kotirae	6067
3697	3693	5	Lomilimil(natingorok)	546
3698	3693	5	Morunyang	4610
3699	3676	4	Lobongia	9190
3700	3699	5	Lobongia	2529
3701	3699	5	Lomusian	3121
3702	3699	5	Longoromit	2872
3703	3699	5	Pajar	668
3704	3676	4	Lodiko	10702
3705	3704	5	Kajiir	1618
3706	3704	5	Kangios	1773
3707	3704	5	Kotome	4224
3708	3704	5	Lopedo/teuso	1474
3709	3704	5	Sakatan	1613
3710	3676	4	Lolelia	16952
3711	3710	5	Kaimese	1776
3712	3710	5	Lochokei	2507
3713	3710	5	Lolelia Center	3343
3714	3710	5	Loteteleit	3719
3715	3710	5	Morukinei	1371
3716	3710	5	Morunyang	1017
3717	3710	5	Narogos	3219
3718	3676	4	Lolelia South	7677
3719	3718	5	Leeny	1337
3720	3718	5	Lokiyekes	2098
3721	3718	5	Muledo	2198
3722	3718	5	Nakatapan	2044
3723	3676	4	Loyoro	17395
3724	3723	5	Lokanayona	5243
3725	3723	5	Lomeruma	5140
3726	3723	5	Toroi	7012
3727	3676	4	Sidok (kopoth)	14140
3728	3727	5	Kasimeri	5480
3729	3727	5	Locherep	4030
3730	3727	5	Longaro	4630
3731	3675	3	Dodoth North County	109518
3732	3731	4	Kaabong East	16936
3733	3732	5	Kalongor	4041
3734	3732	5	Lokolia	5173
3735	3732	5	Losogolo	4291
3736	3732	5	Morulem	3431
3737	3731	4	Kalapata	14996
3738	3737	5	Kurao	4796
3739	3737	5	Meus	4803
3740	3737	5	Moroto	3559
3741	3737	5	Morunyang	1838
3742	3731	4	Kalapata Town Council	16533
3743	3742	5	Kachemichem Ward	2458
3744	3742	5	Kalapata Ward	8761
3745	3742	5	Nabonyia Ward	3948
3746	3742	5	Napetakori Ward	1366
3747	3731	4	Kathile	13683
3748	3747	5	Lemugete	2159
3749	3747	5	Lobatou	2971
3750	3747	5	Lokarengak	1172
3751	3747	5	Narengepak	3257
3752	3747	5	Narionomoru	1679
3753	3747	5	Narube	2445
3754	3731	4	Kathile South	12294
3755	3754	5	Kamacharikol	3463
3756	3754	5	Lois	2286
3757	3754	5	Lokali	2087
3758	3754	5	Nachukul	2358
3759	3754	5	Nariamaaoi	2100
3760	3731	4	Kathile Town Council	10634
3761	3760	5	Jerusalem Ward	4150
3762	3760	5	Kathile Ward	2814
3763	3760	5	Teregu Ward	3670
3764	3731	4	Lotim	24442
3765	3764	5	Kakutatom	3727
3766	3764	5	Kaloboki	4706
3767	3764	5	Kosui	3525
3768	3764	5	Lotim	6394
3769	3764	5	Morukori	6090
3770	3675	3	Ik County	17872
3771	3770	4	Kamion	3652
3772	3771	5	Kamion	1435
3773	3771	5	Kokosowa	838
3774	3771	5	Nawadou	1379
3775	3770	4	Morungole	11069
3776	3775	5	Lokwakaramoe	2107
3777	3775	5	Morungole	3873
3778	3775	5	Usake	5089
3779	3770	4	Timu	3151
3780	3779	5	Kapalu	1352
3781	3779	5	Loitanit	913
3782	3779	5	Lokinene	886
3783	4	2	Kabale	285588
3784	3783	3	Kabale Municipality	64695
3785	3784	4	Kabale Central	21059
3786	3785	5	Butobere	4390
3787	3785	5	Central	4480
3788	3785	5	Kigongi Ward	4456
3789	3785	5	Nyabikoni	7733
3790	3784	4	Kabale Northern	16160
3791	3790	5	Kijuguta	5344
3792	3790	5	Lower Bugongi	4402
3793	3790	5	Rutooma	2325
3794	3790	5	Upper Bugongi	4089
3795	3784	4	Kabale Southern	27476
3796	3795	5	Karubanda	5698
3797	3795	5	Kirigime	7685
3798	3795	5	Mwanjari	9448
3799	3795	5	Rushaki	4645
3800	3783	3	Ndorwa County	220893
3801	3800	4	Buhara	31105
3802	3801	5	Bugarama	4128
3803	3801	5	Buhara	4371
3804	3801	5	Karweru (kafunjo)	5745
3805	3801	5	Kitanga	3184
3806	3801	5	Muyebe	3659
3807	3801	5	Ntarabana	3682
3808	3801	5	Rwene	6336
3809	3800	4	Butanda	14900
3810	3809	5	Bigaaga	3310
3811	3809	5	Butanda	2625
3812	3809	5	Kabere	2015
3813	3809	5	Kifurugutu	1865
3814	3809	5	Kinyamari	1712
3815	3809	5	Murambo	1211
3816	3809	5	Nyamiryango	2162
3817	3800	4	Kaharo	22349
3818	3817	5	Bugarama	4106
3819	3817	5	Burambira	2701
3820	3817	5	Kaharo	3950
3821	3817	5	Katenga	3553
3822	3817	5	Kitohwa	3695
3823	3817	5	Nyakasharara	4344
3824	3800	4	Kahungye	12145
3825	3824	5	Buramba	1854
3826	3824	5	Habuhuriro	1660
3827	3824	5	Kahungye	2422
3828	3824	5	Nyombe	1862
3829	3824	5	Rubumba	1650
3830	3824	5	Rwemihanga	2697
3831	3800	4	Kamuganguzi	24810
3832	3831	5	Buranga	3170
3833	3831	5	Kasheregyenyi	3264
3834	3831	5	Katenga	6228
3835	3831	5	Kicumbi	4558
3836	3831	5	Kisaasa	2084
3837	3831	5	Kyasano	2510
3838	3831	5	Mayengo	2996
3839	3800	4	Katuna Town Council	10662
3840	3839	5	Kacerere Ward	2258
3841	3839	5	Kiniogo	2353
3842	3839	5	Kyonyo	1598
3843	3839	5	Mukarangye	3196
3844	3839	5	Nyinamuronzi Ward	1257
3845	3800	4	Kibuga	8141
3846	3845	5	Karujanga	2480
3847	3845	5	Kibuga	2495
3848	3845	5	Kisibo	1596
3849	3845	5	Rutare	1570
3850	3800	4	Kitumba	26278
3851	3850	5	Bukora	7498
3852	3850	5	Bushuro	6360
3853	3850	5	Bwama Island	47
3854	3850	5	Kitumba	3487
3855	3850	5	Mwendo	8886
3856	3800	4	Kyanamira	24233
3857	3856	5	Kanjobe	2968
3858	3856	5	Katokye	2852
3859	3856	5	Kigata	4664
3860	3856	5	Kyanamira	3916
3861	3856	5	Muyumbu	3022
3862	3856	5	Nyabushabi	4735
3863	3856	5	Nyakagyera	2076
3864	3800	4	Maziba	25156
3865	3864	5	Birambo	4914
3866	3864	5	Kahondo	4140
3867	3864	5	Karweru	2973
3868	3864	5	Kavu	5098
3869	3864	5	Nyanja	4792
3870	3864	5	Rugarama	3239
3871	3800	4	Rubaya	9110
3872	3871	5	Butenga	2208
3873	3871	5	Kitooma	2153
3874	3871	5	Musamba	1661
3875	3871	5	Rwanyena	3088
3876	3800	4	Ryakarimira Town Council	12004
3877	3876	5	Hamuhambo Ward	4115
3878	3876	5	Kacerere Ward	4159
3879	3876	5	Rukore Ward	3730
3880	4	2	Kabarole	230368
3881	3880	3	Burahya County	230368
3882	3881	4	Busoro	13727
3883	3882	5	Busoro	4822
3884	3882	5	Kaswa	5032
3885	3882	5	Kirere	3873
3886	3881	4	Hakibale	21218
3887	3886	5	Kahangi	4523
3888	3886	5	Kiburara	7697
3889	3886	5	Kitule	5571
3890	3886	5	Kyarwagonya	3427
3891	3881	4	Harugongo	23604
3892	3891	5	Busaiga	4484
3893	3891	5	Kyakaigo	9900
3894	3891	5	Nyantaboma	9220
3895	3881	4	Kabende	14473
3896	3895	5	Kyakabaseke	2170
3897	3895	5	Kyamwirukya	3433
3898	3895	5	Masongora	4222
3899	3895	5	Ndaiga	4648
3900	3881	4	Karangura	15053
3901	3900	5	Kamabale	4104
3902	3900	5	Kibwa	4035
3903	3900	5	Nyakitokoli	6914
3904	3881	4	Kasenda	13700
3905	3904	5	Burambira	4292
3906	3904	5	Isunga	3182
3907	3904	5	Kyantambara	3035
3908	3904	5	Nyabweya	3191
3909	3881	4	Kasenda Town Council	11162
3910	3909	5	Kabata Ward	3628
3911	3909	5	Kasenda Ward	3882
3912	3909	5	Rwankenzi Ward	3652
3913	3881	4	Kibasi Town Council	8831
3914	3913	5	Kibasi Ward	2527
3915	3913	5	Kiyaga Ward	3972
3916	3913	5	Kyamuhoro Ward	2332
3917	3881	4	Kicwamba	22626
3918	3917	5	Bwanika	10151
3919	3917	5	Kihondo	6973
3920	3917	5	Mabaale	5502
3921	3881	4	Kijura Town Council	11364
3922	3921	5	Kahuuna Ward	2857
3923	3921	5	Kaisagara Ward	2594
3924	3921	5	Kijura Ward	2602
3925	3921	5	Kyererezi Ward	3311
3926	3881	4	Kiko Town Council	13618
3927	3926	5	Kasiisi Ward	4727
3928	3926	5	Kiko Ward	4105
3929	3926	5	Kyanyawara Ward	3362
3930	3926	5	Nyabubaale Ward	1424
3931	3881	4	Mugusu	15648
3932	3931	5	Kiraaro	3859
3933	3931	5	Kyezire	4829
3934	3931	5	Nyabuswa	6960
3935	3881	4	Mugusu Town Council	12139
3936	3935	5	Burungu Ward	2214
3937	3935	5	Butinda Ward	2359
3938	3935	5	Kibeede Ward	3384
3939	3935	5	Kiboha Ward	2367
3940	3935	5	Kiseru Ward	1815
3941	3881	4	Ruteete	19454
3942	3941	5	Kyamukoka	7115
3943	3941	5	Rurama	5886
3944	3941	5	Rwaihamba	6453
3945	3881	4	Rwengaju	13751
3946	3945	5	Bwabya	4953
3947	3945	5	Kicuna	3919
3948	3945	5	Kidubuli	4879
3949	2	2	Kaberamaido	140986
3950	3949	3	Kaberamaido County	77949
3951	3950	4	Alwa	17272
3952	3951	5	Ongolangol	7066
3953	3951	5	Palatau	10206
3954	3950	4	Aperikira	19951
3955	3954	5	Abirabira	3816
3956	3954	5	Aperikira	6366
3957	3954	5	Okapel	3286
3958	3954	5	Olelai	6483
3959	3950	4	Kaberamaido	23155
3960	3959	5	Acanpi	9222
3961	3959	5	Kaberamaido	6454
3962	3959	5	Kamuk	7479
3963	3950	4	Kaberamaido Town Council	5265
3964	3963	5	Alem Ward	654
3965	3963	5	Ararak Ward	1780
3966	3963	5	Majengo Ward	2831
3967	3950	4	Oriamo	12306
3968	3967	5	Abalang	2851
3969	3967	5	Apele	5170
3970	3967	5	Oriamo	4285
3971	3949	3	Ochero County	63037
3972	3971	4	Kobulubulu	14093
3973	3972	5	Aboltok	2523
3974	3972	5	Akwalakwala	3497
3975	3972	5	Kabalkweru	4856
3976	3972	5	Katinge	3217
3977	3971	4	Ochero	29735
3978	3977	5	Kagaa	7011
3979	3977	5	Kanyalam	7156
3980	3977	5	Swagere	15568
3981	3971	4	Ochero Town Council	6913
3982	3981	5	Kagaa Ward	3688
3983	3981	5	Okeratok Ward	1748
3984	3981	5	Omodoi Ward	1477
3985	3971	4	Okile	12296
3986	3985	5	Murem	3567
3987	3985	5	Ogak	3484
3988	3985	5	Ogerai	2559
3989	3985	5	Okile	2686
3990	4	2	Kagadi	471111
3991	3990	3	Buyaga East County	210418
3992	3991	4	Isunga	7366
3993	3992	5	Isunga	2155
3994	3992	5	Kahunde	1705
3995	3992	5	Kicope	1649
3996	3992	5	Kijonjomi	1857
3997	3991	4	Kabamba	24549
3998	3997	5	Kabamba	3331
3999	3997	5	Kinaga	2791
4000	3997	5	Kiryanjagi	2944
4001	3997	5	Mbogwa	2916
4002	3997	5	Nyakasozi	3670
4003	3997	5	Rusekere	7240
4004	3997	5	Ruzaire	1657
4005	3991	4	Kagadi	16364
4006	4005	5	Busirabo	4127
4007	4005	5	Kanyangoma	3705
4008	4005	5	Kenga	4095
4009	4005	5	Kihayura	4437
4010	3991	4	Kagadi Town Council	31602
4011	4010	5	Kagadi Central Ward	9645
4012	4010	5	Kibanga Ward	4026
4013	4010	5	Kiraba Ward	4764
4014	4010	5	Kitegwa Ward	4181
4015	4010	5	Kyomukama Ward	4700
4016	4010	5	Mambugu Ward	4286
4017	3991	4	Kamuroza	9045
4018	4017	5	Kamuroza	3248
4019	4017	5	Kikomagwa	1961
4020	4017	5	Kyakataba	2064
4021	4017	5	Kyarwakya	1772
4022	3991	4	Kicucura	18624
4023	4022	5	Bugwara	2759
4024	4022	5	Kicucura	2753
4025	4022	5	Kitemba	3900
4026	4022	5	Kitooro	5429
4027	4022	5	Kyabisulita	2166
4028	4022	5	Kyamajegere	1617
4029	3991	4	Kinyarugonjo	6052
4030	4029	5	Kinyarugonjo	2179
4031	4029	5	Mburamaizi	1361
4032	4029	5	Mutunguru	2512
4033	3991	4	Kiryanga	17482
4034	4033	5	Kiduuma	4852
4035	4033	5	Kihingana	2563
4036	4033	5	Kikonda	3490
4037	4033	5	Kiryanga	3329
4038	4033	5	Nyaisamba	3248
4039	3991	4	Kyanaisoke	4646
4040	4039	5	Kacundwa	920
4041	4039	5	Kyanaisoke	1342
4042	4039	5	Naigana	572
4043	4039	5	Ngara	1812
4044	3991	4	Kyenzige	8826
4045	4044	5	Kitema	4925
4046	4044	5	Mpamba	1582
4047	4044	5	Nyabuhike	2319
4048	3991	4	Kyenzige Town Council	13289
4049	4048	5	Kanyegaramire Ward	2833
4050	4048	5	Kasokero Ward	1892
4051	4048	5	Kigoye Ward	1651
4052	4048	5	Kyenzige Ward	5150
4053	4048	5	Mpamba Ward	1763
4054	3991	4	Mabaale	3032
4055	4054	5	Kaitemba	1848
4056	4054	5	Kitemuzi	1184
4057	3991	4	Mabaale Town Council	13838
4058	4057	5	Karaihya Ward	1287
4059	4057	5	Katonzi Ward	2729
4060	4057	5	Kyetera Ward	2753
4061	4057	5	Kyeya Ward	3083
4062	4057	5	Mukumbwa Ward	1778
4063	4057	5	Nyamyaka Ward	2208
4064	3991	4	Nyabutanzi	12510
4065	4064	5	Kihura	2265
4066	4064	5	Kimanya	2968
4067	4064	5	Kyamasega	4372
4068	4064	5	Nyabutanzi	2905
4069	3991	4	Pachwa	11670
4070	4069	5	Kyabasara	6842
4071	4069	5	Kyakabanda	4828
4072	3991	4	Pachwa Town Council	11523
4073	4072	5	Gayaza Ward	2455
4074	4072	5	Kahuniro Ward	2484
4075	4072	5	Kamata Ward	2721
4076	4072	5	Nyamigisa Ward	2074
4077	4072	5	Pachwa Ward	1789
4078	3990	3	Buyaga West County	260693
4079	4078	4	Buhumuliro	5921
4080	4079	5	Buhumuliro	1470
4081	4079	5	Bukora	890
4082	4079	5	Bweranyange	1372
4083	4079	5	Kasasa	1324
4084	4079	5	Namugongo	865
4085	4078	4	Burora	17224
4086	4085	5	Burora	4000
4087	4085	5	Kamambu	1619
4088	4085	5	Kayembe	1523
4089	4085	5	Kihumuro	1817
4090	4085	5	Nyamigisa	1303
4091	4085	5	Nyamukaikuru	2510
4092	4085	5	Rutuuza	2275
4093	4085	5	Rwentale	2177
4094	4078	4	Bwikara	16705
4095	4094	5	Kamusegu	3625
4096	4094	5	Kisuura	5334
4097	4094	5	Ngoma	3091
4098	4094	5	Nyamasa	4655
4099	4078	4	Galiboleka	12439
4100	4099	5	Bugarama	2159
4101	4099	5	Nyakasozi	4009
4102	4099	5	Nyankoma	3481
4103	4099	5	Rutooma	2790
4104	4078	4	Kanyabeebe	4509
4105	4104	5	Kanyabebe	1125
4106	4104	5	Kanyabeebe Central	1427
4107	4104	5	Kashagali	914
4108	4104	5	Rubaale	1043
4109	4078	4	Kyakabadiima	8029
4110	4109	5	Hamugyi	3059
4111	4109	5	Kamuyange	2117
4112	4109	5	Kyakabadiima	2853
4113	4078	4	Kyaterekera	10439
4114	4113	5	Buswaka	3230
4115	4113	5	Wangeyo	7209
4116	4078	4	Kyaterekera Town Council	19782
4117	4116	5	Buswaka Ward	4903
4118	4116	5	Kyaterekera East Ward	5452
4119	4116	5	Kyaterekera West Ward	5232
4120	4116	5	Nyantonzi Ward	4195
4121	4078	4	Mairirwe	11469
4122	4121	5	Batahulira	2556
4123	4121	5	Kayanja	3904
4124	4121	5	Kyema	1679
4125	4121	5	Mairirwe	3330
4126	4078	4	Mpeefu	30149
4127	4126	5	Rubirizi	11904
4128	4126	5	Rwabaranga	18245
4129	4078	4	Mpeefu Ya Sande Town Council	19010
4130	4129	5	Buligira Ward	3849
4131	4129	5	Kurukuru Ward	4027
4132	4129	5	Mpeefu Central Ward	4369
4133	4129	5	Mugyenza Ward	3729
4134	4129	5	Nyamukara Ward	3036
4135	4078	4	Muhorro	10444
4136	4135	5	Kabuga	3548
4137	4135	5	Kasoga	2287
4138	4135	5	Kyesamire	2543
4139	4135	5	Nyamacumu	2066
4140	4078	4	Muhorro Town Council	29706
4141	4140	5	Butumba Ward	4773
4142	4140	5	Kapyemi Ward	3354
4143	4140	5	Karuswiga Ward	5023
4144	4140	5	Kisweeka Ward	6503
4145	4140	5	Nyamiti Ward	5751
4146	4140	5	Nyanseke Ward	4302
4147	4078	4	Ndaiga	9435
4148	4147	5	Kamina	1160
4149	4147	5	Kitebere	3534
4150	4147	5	Ndaiga	2040
4151	4147	5	Nyamasoga	2701
4152	4078	4	Nyakarongo	23796
4153	4152	5	Katalemwa	4642
4154	4152	5	Katikengeyo	4468
4155	4152	5	Kisungu	6235
4156	4152	5	Maberenga	4174
4157	4152	5	Nyakarongo	4277
4158	4078	4	Rugashari	5749
4159	4158	5	Izahuura	2132
4160	4158	5	Kibaanda	587
4161	4158	5	Kinaaba	1168
4162	4158	5	Ndeeba	1862
4163	4078	4	Rugashari Town Council	9759
4164	4163	5	Kyabitundu Ward	1406
4165	4163	5	Namirembe Ward	1355
4166	4163	5	Rugashari Ward	4323
4167	4163	5	Rutooma Ward	877
4168	4163	5	Yorudan Ward	1798
4169	4078	4	Ruteete	7098
4170	4169	5	Kinyarwanda	3358
4171	4169	5	Nyakasheema	1735
4172	4169	5	Rubona	2005
4173	4078	4	Rutete Town Council	9030
4174	4173	5	Kamaira Ward	941
4175	4173	5	Kasasa Ward	1494
4176	4173	5	Kentomi Ward	1870
4177	4173	5	Nyakashema Ward	1501
4178	4173	5	Ruteete Ward	3224
4179	4	2	Kakumiro	428176
4180	4179	3	Bugangaizi East County	156609
4181	4180	4	Katikara	23088
4182	4181	5	Katikara	7256
4183	4181	5	Kiryandongo	7475
4184	4181	5	Kitaboona	4456
4185	4181	5	Kyangota	3901
4186	4180	4	Kibijjo	30524
4187	4186	5	Isunga	4176
4188	4186	5	Karangala	1925
4189	4186	5	Kibijjo	5622
4190	4186	5	Kitutuma	5941
4191	4186	5	Muziranduru	6077
4192	4186	5	Sazike	6783
4193	4180	4	Kisiita	10899
4194	4193	5	Buhonda	2204
4195	4193	5	Kyakapere	2013
4196	4193	5	Kyakijuuto	2219
4197	4193	5	Kyobu	1802
4198	4193	5	Nyamirama	2661
4199	4180	4	Kisiita Town Council	19570
4200	4199	5	Bwikaragye Ward	2797
4201	4199	5	Kisiita Central Ward	9395
4202	4199	5	Kyabaliitwa Ward	3721
4203	4199	5	Nyabirungi Ward	3657
4204	4180	4	Mpasaana	14282
4205	4204	5	Binikira	4591
4206	4204	5	Bujaaja	6724
4207	4204	5	Rwamata	2967
4208	4180	4	Mpasaana Town Council	14605
4209	4208	5	Central Ward	6510
4210	4208	5	Kijuungu Ward	1950
4211	4208	5	Mpongo Ward	2721
4212	4208	5	Rwamata Ward	3424
4213	4180	4	Mwitanzige	19382
4214	4213	5	Ijumangabo	2522
4215	4213	5	Kyabusinge	2464
4216	4213	5	Kyakuterekera	4567
4217	4213	5	Mwitanzige	7640
4218	4213	5	Rwamadongo	2189
4219	4180	4	Nkooko	15248
4220	4219	5	Kitegura	2912
4221	4219	5	Lubumbo	2743
4222	4219	5	Nsaana	4280
4223	4219	5	Rutooma	5313
4224	4180	4	Nkooko Town Council	9011
4225	4224	5	Gamugole Ward	2257
4226	4224	5	Kamusenene Ward	2335
4227	4224	5	Kyabakamba Ward	1704
4228	4224	5	Nkooko Ward	2715
4229	4179	3	Bugangaizi South County	123337
4230	4229	4	Birembo	15901
4231	4230	5	Igayaza	1001
4232	4230	5	Kisiija	2122
4233	4230	5	Kyakarongo	6326
4234	4230	5	Nyansimbi	6452
4235	4229	4	Bwanswa	14909
4236	4235	5	Bukuumi	2188
4237	4235	5	Kihumuro	6461
4238	4235	5	Kihurumba	2740
4239	4235	5	Nkondo	3520
4240	4229	4	Igayaza Town Council	22077
4241	4240	5	Buramagi Ward	6779
4242	4240	5	Igayaza Ward	4900
4243	4240	5	Kaboijana Ward	7222
4244	4240	5	Rubazi Ward	3176
4245	4229	4	Kakumiro Town Council	15688
4246	4245	5	Central Ward	4253
4247	4245	5	Kabworo Ward	1973
4248	4245	5	Kanyawawa Ward	2640
4249	4245	5	Masonde Ward	3333
4250	4245	5	Semwema Ward	3489
4251	4229	4	Kasambya	29296
4252	4251	5	Kakayo	5873
4253	4251	5	Kihamba	4738
4254	4251	5	Kikaada	3002
4255	4251	5	Kiryangobe	5458
4256	4251	5	Kiweeza	3308
4257	4251	5	Mitembo	4422
4258	4251	5	Semuto	2495
4259	4229	4	Kisengwe	14813
4260	4259	5	Kahungera	2842
4261	4259	5	Kyamagwara	1675
4262	4259	5	Kyebando	4927
4263	4259	5	Kyemengo	5369
4264	4229	4	Kyabasaija	10653
4265	4264	5	Gayaza	2831
4266	4264	5	Kyandara	3132
4267	4264	5	Lubaya	2370
4268	4264	5	Mpaanga	2320
4269	4179	3	Bugangaizi West County	148230
4270	4269	4	Kakindo	27243
4271	4270	5	Kasenyi	5936
4272	4270	5	Katatemwa	8433
4273	4270	5	Kihuuna	7996
4274	4270	5	Kisaigi	4878
4275	4269	4	Kakindo Town Council	14745
4276	4275	5	Kinena Ward	3578
4277	4275	5	Kisaigi Ward	3792
4278	4275	5	Majeru Ward	1825
4279	4275	5	Nkwaki Ward	1924
4280	4275	5	Rukunyu Ward	3626
4281	4269	4	Kijangi	17839
4282	4281	5	Kigando	3553
4283	4281	5	Kijangi	4709
4284	4281	5	Nyakatete	2742
4285	4281	5	Rwembuba	6835
4286	4269	4	Kikoora	14245
4287	4286	5	Kigoma	2413
4288	4286	5	Kikoora	6996
4289	4286	5	Nyakatooke	1979
4290	4286	5	Nyamaligita	2857
4291	4269	4	Kikwaya	17393
4292	4291	5	Kamuli	3119
4293	4291	5	Kikwaya	7346
4294	4291	5	Kyakabangali	3289
4295	4291	5	Kyakajumbi	3639
4296	4269	4	Kitaihuka	24912
4297	4296	5	Kasozi	4605
4298	4296	5	Kijegere	3080
4299	4296	5	Kinunda	3268
4300	4296	5	Kiriisa	5364
4301	4296	5	Kitaihuka	8595
4302	4269	4	Nalweyo	19025
4303	4302	5	Irindimura	5140
4304	4302	5	Kakiseke	3310
4305	4302	5	Karuuko	5076
4306	4302	5	Kijwenge	5499
4307	4269	4	Nyarweyo Town Council	12828
4308	4307	5	Buruuko Ward	3132
4309	4307	5	Kyabeya Ward	4573
4310	4307	5	Masaka Ward	2540
4311	4307	5	Nyarweyo Ward	2583
4312	2	2	Kalaki	149736
4313	4312	3	Kalaki County	149736
4314	4313	4	Anyara	15569
4315	4314	5	Anyara	5746
4316	4314	5	Moru	5285
4317	4314	5	Omid	4538
4318	4313	4	Apapai	16299
4319	4318	5	Apapai	6271
4320	4318	5	Kamidakan	4126
4321	4318	5	Ousia	5902
4322	4313	4	Bululu	17208
4323	4322	5	Kibimo	7170
4324	4322	5	Obur	10038
4325	4313	4	Kakure	16759
4326	4325	5	Kakure	6513
4327	4325	5	Opungure	5571
4328	4325	5	Oyomai	4675
4329	4313	4	Kalaki	16636
4330	4329	5	Kadinya	5548
4331	4329	5	Kakere	5113
4332	4329	5	Kamuda	5975
4333	4313	4	Kalaki Town Council	6619
4334	4333	5	Central Ward	1813
4335	4333	5	Dokdwong	817
4336	4333	5	Eyenga Ward	894
4337	4333	5	Obule Ward	2533
4338	4333	5	Okweje Ward	562
4339	4313	4	Ocelakur	13873
4340	4339	5	Ipenet	4907
4341	4339	5	Ocelakur	4355
4342	4339	5	Sangai	4611
4343	4313	4	Ogwolo	12705
4344	4343	5	Angolitok	2837
4345	4343	5	Kaberpila	5247
4346	4343	5	Ogwolo	4621
4347	4313	4	Otuboi	24616
4348	4347	5	Amoru	773
4349	4347	5	Kaberkole	3407
4350	4347	5	Kadie	4767
4351	4347	5	Lwala	11706
4352	4347	5	Opiltok	3963
4353	4313	4	Otuboi Town Council	9452
4354	4353	5	Abermunyu Ward	3286
4355	4353	5	Abia Ward	2025
4356	4353	5	Central Ward	2495
4357	4353	5	Kadie Ward	1646
4358	1	2	Kalangala	74411
4359	4358	3	Bujumba County	39563
4360	4359	4	Bujumba	14801
4361	4360	5	Bujumba	3255
4362	4360	5	Bunyama	2949
4363	4360	5	Bwendero	4738
4364	4360	5	Mulabana	3859
4365	4359	4	Kalangala Town Council	7609
4366	4365	5	Kalangala A Ward	1972
4367	4365	5	Kalangala B Ward	5637
4368	4359	4	Mugoye	17153
4369	4368	5	Bbeta	7881
4370	4368	5	Kagulube	4305
4371	4368	5	Kayunga	4967
4372	4358	3	Kyamuswa County	34848
4373	4372	4	Bubeke	6703
4374	4373	5	Bubeke	4836
4375	4373	5	Jaana	1867
4376	4372	4	Bufumira	13913
4377	4376	5	Bufumira	4728
4378	4376	5	Lulamba	9185
4379	4372	4	Kyamuswa	8295
4380	4379	5	Buwanga	3364
4381	4379	5	Buzingo	4931
4382	4372	4	Mazinga	5937
4383	4382	5	Buggala	4093
4384	4382	5	Butulume	1844
4385	2	2	Kaliro	286397
4386	4385	3	Bulamogi County	209560
4387	4386	4	Budomero	19771
4388	4387	5	Budomero	6345
4389	4387	5	Kiyunga	3686
4390	4387	5	Kyanfuba	4895
4391	4387	5	Nabitende	4845
4392	4386	4	Bulumba Town Council	10750
4393	4392	5	Bujjejje Ward	1686
4394	4392	5	Bulumba Central Ward	2459
4395	4392	5	Busunga Ward	522
4396	4392	5	Londe Ward	2458
4397	4392	5	Masuna Ward	332
4398	4392	5	Nalenya Ward	1789
4399	4392	5	Nkonte Ward	1504
4400	4386	4	Bumanya	29262
4401	4400	5	Bulima	3999
4402	4400	5	Bumanya	6205
4403	4400	5	Kalalu	5461
4404	4400	5	Kasuleta	3799
4405	4400	5	Kyani	5893
4406	4400	5	Namusolo	3905
4407	4386	4	Buyinda	20939
4408	4407	5	Bukonde	4759
4409	4407	5	Buyinda	3856
4410	4407	5	Kiranga	3464
4411	4407	5	Madibira	4712
4412	4407	5	Namejje	4148
4413	4386	4	Gadumire	22139
4414	4413	5	Bupyana	3649
4415	4413	5	Butambala	2257
4416	4413	5	Buyuge	3320
4417	4413	5	Gadumire	3827
4418	4413	5	Isalo	2093
4419	4413	5	Panyolo	4251
4420	4413	5	Tababa	2742
4421	4386	4	Kaliro Town Council	23410
4422	4421	5	Budini Ward	2383
4423	4421	5	Bukumankoola	5799
4424	4421	5	Buyunga Ward	5092
4425	4421	5	Lumbuye	6905
4426	4421	5	Naigombwa	3231
4427	4386	4	Kasokwe	18034
4428	4427	5	Busanda	3248
4429	4427	5	Butajjube	2634
4430	4427	5	Buyodi	3336
4431	4427	5	Bwayuya	2963
4432	4427	5	Kasokwe	5853
4433	4386	4	Kisinda	19005
4434	4433	5	Busulumba	5735
4435	4433	5	Kibwiza	3292
4436	4433	5	Kisinda	3473
4437	4433	5	Lubulo	2221
4438	4433	5	Mpambwa	1543
4439	4433	5	Nawandyo	2741
4440	4386	4	Namugongo	21935
4441	4440	5	Bugoda	1861
4442	4440	5	Bugonza	2258
4443	4440	5	Butege	2598
4444	4440	5	Igulamubiri	2726
4445	4440	5	Kanakamba	3114
4446	4440	5	Nabikoli	2273
4447	4440	5	Namukoge	3704
4448	4440	5	Natwana	3401
4449	4386	4	Namwiwa	11820
4450	4449	5	Kiganda	1958
4451	4449	5	Kiwanabuzi	3297
4452	4449	5	Namwiwa	1795
4453	4449	5	Saaka	4770
4454	4386	4	Namwiwa Town Council	12495
4455	4454	5	Bilari Ward	2413
4456	4454	5	Bukaire Ward	1466
4457	4454	5	Bunswezya Ward	2436
4458	4454	5	Busereka Ward	1017
4459	4454	5	Kanabugo Ward	1818
4460	4454	5	Namwiwa Ward	1607
4461	4454	5	Wangobo Ward	1738
4462	4385	3	Bulamogi North West County	76837
4463	4462	4	Bukamba	30956
4464	4463	5	Bujugu	2845
4465	4463	5	Bukamba	3951
4466	4463	5	Busereka	4022
4467	4463	5	Buvulunguti	4915
4468	4463	5	Kitega	5779
4469	4463	5	Nangala	4650
4470	4463	5	Nawampiti	4794
4471	4462	4	Nansololo	17433
4472	4471	5	Bulike	3151
4473	4471	5	Buluya	2558
4474	4471	5	Muhira	5686
4475	4471	5	Nansololo	3313
4476	4471	5	Nantamali	2725
4477	4462	4	Nawaikoke	18148
4478	4477	5	Buhangala	5817
4479	4477	5	Bupeni	2866
4480	4477	5	Kyambaya	1000
4481	4477	5	Namawa	4744
4482	4477	5	Nsamule	3721
4483	4462	4	Nawaikoke Town Council	10300
4484	4483	5	Bugwabi Ward	1400
4485	4483	5	Musiha Ward	1769
4486	4483	5	Mwangha Ward	1360
4487	4483	5	Nawaikoke	2801
4488	4483	5	Nombe	994
4489	4483	5	Walyabira Ward	1976
4490	1	2	Kalungu	221569
4491	4490	3	Kalungu County	221569
4492	4491	4	Bukulula	56224
4493	4492	5	Bugonzi	9104
4494	4492	5	Kasaali	5197
4495	4492	5	Kiti	10941
4496	4492	5	Kyambala	5058
4497	4492	5	Lusango	5642
4498	4492	5	Lusasa/kalungi	4124
4499	4492	5	Mabuye	4711
4500	4492	5	Mukoko	11447
4501	4491	4	Kalungu	35268
4502	4501	5	Bulawula	6088
4503	4501	5	Bwasandeku	7554
4504	4501	5	Kaliiro	5220
4505	4501	5	Kitamba	2763
4506	4501	5	Nabutongwa	3645
4507	4501	5	Ntale	4929
4508	4501	5	Villa Maria	5069
4509	4491	4	Kalungu Town Council	8758
4510	4509	5	Kalungu Ward	2733
4511	4509	5	Kikukumbi Ward	1585
4512	4509	5	Kisaawa Ward	1890
4513	4509	5	Lusaana Ward	2550
4514	4491	4	Kyamulibwa	28669
4515	4514	5	Bakijjulula	4844
4516	4514	5	Busoga	5913
4517	4514	5	Kabaale	4989
4518	4514	5	Kigasa	8367
4519	4514	5	Kitosi	4556
4520	4491	4	Kyamulibwa Town Council	12402
4521	4520	5	Bakaluba Ward	2217
4522	4520	5	Central Ward	2478
4523	4520	5	Kateregga Ward	2224
4524	4520	5	Yakobo Ward	3406
4525	4520	5	Zaake Ward	2077
4526	4491	4	Lukaya Town Council	32825
4527	4526	5	Bajja Ward	3833
4528	4526	5	Central Ward	11847
4529	4526	5	Kaliro Ward	10068
4530	4526	5	Magezi Kizungu Ward	7077
4531	4491	4	Lwabenge	47423
4532	4531	5	Bugomola	12124
4533	4531	5	Bwesa	13480
4534	4531	5	Kibisi	7687
4535	4531	5	Kiragga	14132
4536	1	2	Kampala	1797722
4537	4536	3	Kampala Central Division	81658
4538	4537	4	Kampala Central Division	81658
4539	4538	5	Bukesa	9438
4540	4538	5	Civic Centre	1847
4541	4538	5	Industrial Area	3569
4542	4538	5	Kagugube	6899
4543	4538	5	Kamwokya I	1818
4544	4538	5	Kamwokya II	16020
4545	4538	5	Kisenyi I	1594
4546	4538	5	Kisenyi II	4519
4547	4538	5	Kisenyi III	6767
4548	4538	5	Kololo I	2267
4549	4538	5	Kololo II	1129
4550	4538	5	Kololo III	1407
4551	4538	5	Kololo IV	1509
4552	4538	5	Mengo	11025
4553	4538	5	Nakasero I	1376
4554	4538	5	Nakasero II	2176
4555	4538	5	Nakasero III	1933
4556	4538	5	Nakasero IV	1829
4557	4538	5	Nakivubo	1062
4558	4538	5	Old Kampala	3474
4559	4536	3	Kawempe Division	390170
4560	4559	4	Kawempe Division	390170
4561	4560	5	Bwaise I	21642
4562	4560	5	Bwaise II	19975
4563	4560	5	Bwaise III	10591
4564	4560	5	Kanyanya	26373
4565	4560	5	Kawempe I	38675
4566	4560	5	Kawempe II	27102
4567	4560	5	Kazo-Angola	23684
4568	4560	5	Kikaya	33751
4569	4560	5	Komamboga	18519
4570	4560	5	Kyebando	42357
4571	4560	5	Makerere I	12025
4572	4560	5	Makerere II	19267
4573	4560	5	Makerere III	16049
4574	4560	5	Mpererwe	9092
4575	4560	5	Muk - Muluka I	3564
4576	4560	5	Muk - Muluka II	4288
4577	4560	5	Muk - Muluka III	2287
4578	4560	5	Muk - Muluka IV	3857
4579	4560	5	Mulago I	11282
4580	4560	5	Mulago II	13984
4581	4560	5	Mulago III	20757
4582	4560	5	Wandegeya	11049
4583	4536	3	Makindye Division	486762
4584	4583	4	Makindye Division	486762
4585	4584	5	Bukasa	9658
4586	4584	5	Buziga	19449
4587	4584	5	Ggaba	28501
4588	4584	5	Kabalagala	15578
4589	4584	5	Kansanga	27676
4590	4584	5	Katwe I	8583
4591	4584	5	Katwe II	16414
4592	4584	5	Kibuli	24059
4593	4584	5	Kibuye I	25843
4594	4584	5	Kibuye II	8934
4595	4584	5	Kisugu	21799
4596	4584	5	Lukuli	37337
4597	4584	5	Luwafu	22762
4598	4584	5	Makindye I	21743
4599	4584	5	Makindye II	17098
4600	4584	5	Muyenga	10003
4601	4584	5	Namuwongo	19396
4602	4584	5	Nsambya Central	39018
4603	4584	5	Nsambya Estate	1218
4604	4584	5	Nsambya Police Barracks	54952
4605	4584	5	Nsambya Railways	1530
4606	4584	5	Salaama	37829
4607	4584	5	Wabigalo	17382
4608	4536	3	Nakawa Division	428732
4609	4608	4	Nakawa Division	428732
4610	4609	5	Banda	28685
4611	4609	5	Bugoloobi	9511
4612	4609	5	Bukoto I	25905
4613	4609	5	Bukoto II	24315
4614	4609	5	Butabika	30549
4615	4609	5	Itek	2635
4616	4609	5	Kiswa	4713
4617	4609	5	Kiwatule	20788
4618	4609	5	Kyambogo	3222
4619	4609	5	Kyanja	36425
4620	4609	5	Luzira	19139
4621	4609	5	Luzira Prisons	35043
4622	4609	5	Mbuya I	23873
4623	4609	5	Mbuya II	51194
4624	4609	5	Mutungo	63191
4625	4609	5	Nabisunsa	2494
4626	4609	5	Naguru I	728
4627	4609	5	Naguru II	25273
4628	4609	5	Nakawa	2318
4629	4609	5	Nakawa Institutions	450
4630	4609	5	Ntinda	10344
4631	4609	5	Upk	3040
4632	4609	5	Upper Estate	4897
4633	4536	3	Rubaga Division	410400
4634	4633	4	Rubaga Division	410400
4635	4634	5	Busega	35918
4636	4634	5	Kabowa	34739
4637	4634	5	Kasubi	54364
4638	4634	5	Lubya	70987
4639	4634	5	Lungujja	41760
4640	4634	5	Mutundwe	37682
4641	4634	5	Najjanankumbi I	14109
4642	4634	5	Najjanankumbi II	12560
4643	4634	5	Nakulabye	21466
4644	4634	5	Namirembe	16555
4645	4634	5	Nateete	22463
4646	4634	5	Ndeeba	18404
4647	4634	5	Rubaga	29393
4648	2	2	Kamuli	540252
4649	4648	3	Bugabula County	306092
4650	4649	4	Balawoli	11397
4651	4650	5	Nabulezi	7343
4652	4650	5	Namaira	4054
4653	4649	4	Balawoli Town Council	16278
4654	4653	5	Balawoli Northern	6949
4655	4653	5	Kawaga Southern	9329
4656	4649	4	Bulopa	24265
4657	4656	5	Bukutu	5154
4658	4656	5	Bulopa	8513
4659	4656	5	Mpakitoni	4737
4660	4656	5	Nagamuli	3839
4661	4656	5	Nagwenyi	2022
4662	4649	4	Butansi	34323
4663	4662	5	Bugeywa	10226
4664	4662	5	Butansi	6090
4665	4662	5	Naibowa	5730
4666	4662	5	Naluwoli	12277
4667	4649	4	Kagumba	45448
4668	4667	5	Kagumba	12532
4669	4667	5	Kasolwe	15097
4670	4667	5	Kibuye	6556
4671	4667	5	Kiige	11263
4672	4649	4	Kitayunjwa	42740
4673	4672	5	Budhatemwa	5683
4674	4672	5	Buganza	3996
4675	4672	5	Butende	5866
4676	4672	5	Kitayunjwa	6932
4677	4672	5	Namaganda	3829
4678	4672	5	Namisambya I	5848
4679	4672	5	Nawango	5705
4680	4672	5	Nawansaso	4881
4681	4649	4	Nabwigulu	20702
4682	4681	5	Nabirumba I	3104
4683	4681	5	Nabirumba II	5716
4684	4681	5	Nabwigulu	7266
4685	4681	5	Namunyingi	4616
4686	4649	4	Namasagali	43127
4687	4686	5	Bwiiza	13004
4688	4686	5	Kasozi	11899
4689	4686	5	Kisaikye	15211
4690	4686	5	Namasagali	3013
4691	4649	4	Namwendwa	45412
4692	4691	5	Bugondha	7191
4693	4691	5	Bulange	4885
4694	4691	5	Bulogo	5622
4695	4691	5	Isingo	1537
4696	4691	5	Kinu	5726
4697	4691	5	Kyeeya	7588
4698	4691	5	Makoka	8259
4699	4691	5	Ndalike	4604
4700	4649	4	Namwendwa Town Council	22400
4701	4700	5	Buluuya Ward	2224
4702	4700	5	Bulyango Ward	3829
4703	4700	5	Busejja Ward	2938
4704	4700	5	Busimba Ward	4646
4705	4700	5	Mission Ward	8763
4706	4648	3	Buzaaya County	157402
4707	4706	4	Bugulumbya	23431
4708	4707	5	Bugulumbya	4209
4709	4707	5	Busandha	4072
4710	4707	5	Buwoya	3535
4711	4707	5	Nakibungulya	5120
4712	4707	5	Nawanende Town Board	4731
4713	4707	5	Nawangoma	1764
4714	4706	4	Kasambira Town Council	11378
4715	4714	5	Kasambira Ward	11378
4716	4706	4	Kisozi	16552
4717	4716	5	Izaniro	3362
4718	4716	5	Kakunyu	3621
4719	4716	5	Kiyunga	5326
4720	4716	5	Namaganda	4243
4721	4706	4	Kisozi Town Council	11049
4722	4721	5	East Ward	3700
4723	4721	5	West Ward	7349
4724	4706	4	Magogo	18555
4725	4724	5	Buteme	3481
4726	4724	5	Kakira	3125
4727	4724	5	Lwanyama	1743
4728	4724	5	Magogo	3295
4729	4724	5	Matumu	3245
4730	4724	5	Nankandulo	3666
4731	4706	4	Mbulamuti	18455
4732	4731	5	Bugondha	5712
4733	4731	5	Buluya	5330
4734	4731	5	Kiyunga	7413
4735	4706	4	Mbulamuti Town Council	11435
4736	4735	5	Lugoloire Ward	5075
4737	4735	5	Mbulamuti Ward	6360
4738	4706	4	Nawanyago	15722
4739	4738	5	Bupadhengo	6247
4740	4738	5	Nawantumbi	6020
4741	4738	5	Nawanyago	3455
4742	4706	4	Nawanyago Town Council	8379
4743	4742	5	Bupadhengo Urban Ward	912
4744	4742	5	Nawantumbi Urban Ward	1180
4745	4742	5	Nawanyago East Ward	3097
4746	4742	5	Nawanyago West Ward	3190
4747	4706	4	Wankole	22446
4748	4747	5	Lulyambuzi	6193
4749	4747	5	Luzinga	8214
4750	4747	5	Wankole	8039
4751	4648	3	Kamuli Municipality	76758
4752	4751	4	Northern Division	38027
4753	4752	5	Buwanume Ward	9635
4754	4752	5	Kamuli-Sabawali Ward	5311
4755	4752	5	Kasoigo Ward	11077
4756	4752	5	Muwebwa Ward	6435
4757	4752	5	Namisambya II Ward	5569
4758	4751	4	Southern Division	38731
4759	4758	5	Busota Ward	9616
4760	4758	5	Kamuli-Namwenda Ward	12848
4761	4758	5	Mandwa Ward	3952
4762	4758	5	Mulamba Ward	2261
4763	4758	5	Nakulyaku Ward	10054
4764	4	2	Kamwenge	337167
4765	4764	3	Kibale County	153004
4766	4765	4	Bigodi Town Council	10948
4767	4766	5	Bigodi Ward	4345
4768	4766	5	Bujongobe Ward	3938
4769	4766	5	Kyabakwerere Ward	1403
4770	4766	5	Nyabubale_mahango Ward	1262
4771	4765	4	Busiriba	25855
4772	4771	5	Busiriba	5278
4773	4771	5	Kahondo	4037
4774	4771	5	Kanimi	4432
4775	4771	5	Kinoni	6505
4776	4771	5	Kyakarafa	5603
4777	4765	4	Kabambiro	19494
4778	4777	5	Iruhura	4269
4779	4777	5	Kabambiro	5814
4780	4777	5	Kebisingo	4960
4781	4777	5	Nyamashegwa	4451
4782	4765	4	Kabuga Town Council	6754
4783	4782	5	Businge Ward	1757
4784	4782	5	Kabuga Ward	1528
4785	4782	5	Kakinga Ward	2322
4786	4782	5	Karokarungi Ward	1147
4787	4765	4	Kahunge	22021
4788	4787	5	Kiyagaara	11133
4789	4787	5	Mpanga	7047
4790	4787	5	Nyakahama	3841
4791	4765	4	Kahunge Town Council	13780
4792	4791	5	Kihura Ward	2569
4793	4791	5	Rubaba Ward	3078
4794	4791	5	Rugonjo Ward	3974
4795	4791	5	Rwenkuba Ward	4159
4796	4765	4	Kamwenge	19598
4797	4796	5	Businge	3637
4798	4796	5	Ganyenda	3495
4799	4796	5	Kiziba	4413
4800	4796	5	Kyabandara	4041
4801	4796	5	Nkongoro	4012
4802	4765	4	Kamwenge Town Council	23638
4803	4802	5	Kaburisoke Ward	6417
4804	4802	5	Kamwenge Ward	6613
4805	4802	5	Kitonzi Ward	4811
4806	4802	5	Masaka Ward	3179
4807	4802	5	Rwemirama Ward	2618
4808	4765	4	Rukunyu Town Council	10916
4809	4808	5	Kyakanyemera Ward	3982
4810	4808	5	Rukunyu Ward	3628
4811	4808	5	Rwengoro Ward	3306
4812	4764	3	Kibale East County	184163
4813	4812	4	Biguli	19973
4814	4813	5	Benga	5999
4815	4813	5	Ibuga	2317
4816	4813	5	Kampala B	9090
4817	4813	5	Malere	2567
4818	4812	4	Biguli Town Council	19121
4819	4818	5	Biguli Ward	10459
4820	4818	5	Bitojo Ward	6031
4821	4818	5	Rwebishahi Ward	2631
4822	4812	4	Bihanga	12092
4823	4822	5	Bihanga	3286
4824	4822	5	Kabingo	8806
4825	4812	4	Bwizi	14922
4826	4825	5	Bwizi	6070
4827	4825	5	Kamusenene	4616
4828	4825	5	Nkoni	4236
4829	4812	4	Kabuye	3829
4830	4829	5	Kabuye	1011
4831	4829	5	Mukukuru	1175
4832	4829	5	Mutaama	1643
4833	4812	4	Lyakahungu Town Council	6133
4834	4833	5	Kakinga Ward	851
4835	4833	5	Kanyonza I Ward	1811
4836	4833	5	Kanyonza II Ward	1301
4837	4833	5	Kasozi Ward	885
4838	4833	5	Kijungu Ward	751
4839	4833	5	Rwomuriro Ward	534
4840	4812	4	Nkoma	26028
4841	4840	5	Bisozi	10001
4842	4840	5	Kaberebere	5862
4843	4840	5	Kidunduma	5194
4844	4840	5	Mabale	4971
4845	4812	4	Nkoma-Katalyeba Town Council	16095
4846	4845	5	Buregyeya Ward	3633
4847	4845	5	Kinyonza Ward	3432
4848	4845	5	Mahane Ward	3850
4849	4845	5	Nkoma Ward	5180
4850	4812	4	Ntonwa	22514
4851	4850	5	Buhumuriro	2007
4852	4850	5	Kasorora	2508
4853	4850	5	Kiboota	1755
4854	4850	5	Kikiri	1271
4855	4850	5	Kyakaitaba	4989
4856	4850	5	Masangi	1662
4857	4850	5	Muhunga	3631
4858	4850	5	Ntonwa	4691
4859	4812	4	Rwamwanja Refugee Camp	43456
4860	4859	5	Base Camp II & IV	2809
4861	4859	5	Basecamp I & III	2175
4862	4859	5	Kaihora A	3884
4863	4859	5	Kaihora Bc	1961
4864	4859	5	Kaihora D	1195
4865	4859	5	Kikurra A & B	1493
4866	4859	5	Kyempango A I	899
4867	4859	5	Kyempango A II & III	1926
4868	4859	5	Kyempango A IV & C III	2999
4869	4859	5	Kyempango B I & B II	1914
4870	4859	5	Kyempango B III & C II	2725
4871	4859	5	Kyempango C I	2311
4872	4859	5	Mahani A & B	6934
4873	4859	5	Mahega Zone	3956
4874	4859	5	Nkoma A & Mikole	2591
4875	4859	5	Nkoma B & C	1642
4876	4859	5	Ntenungi Ab	1577
4877	4859	5	Ntenungi C	465
4878	4	2	Kanungu	310062
4879	4878	3	Kinkizi County	310062
4880	4879	4	Bugongi	8493
4881	4880	5	Buziniro	1605
4882	4880	5	Ihembe	1492
4883	4880	5	Kakinga	2503
4884	4880	5	Rushebeya	2893
4885	4879	4	Buhoma Town Council	17052
4886	4885	5	Central Ward	5893
4887	4885	5	Eastern Ward	4517
4888	4885	5	Northern Ward	3536
4889	4885	5	Southern Ward	3106
4890	4879	4	Butogota Town Council	17694
4891	4890	5	Eastern Ward	2736
4892	4890	5	Northern Ward	5107
4893	4890	5	Southern Ward	5124
4894	4890	5	Western Ward	4727
4895	4879	4	Kambuga	16253
4896	4895	5	Kiringa	4917
4897	4895	5	Nyarugunda	2958
4898	4895	5	Nyarutojo	8378
4899	4879	4	Kambuga Town Council	6936
4900	4899	5	Central Ward	1699
4901	4899	5	Eastern Ward	2430
4902	4899	5	Northern Ward	1318
4903	4899	5	Southern Ward	1489
4904	4879	4	Kanungu Town Council	15691
4905	4904	5	Eastern Ward	2895
4906	4904	5	Northern Ward	3768
4907	4904	5	Southern Ward	3836
4908	4904	5	Western Ward	5192
4909	4879	4	Kanyantorogo	13467
4910	4909	5	Burema	3045
4911	4909	5	Kishenyi	3254
4912	4909	5	Nyamigoye	7168
4913	4879	4	Kanyantorogo Town Council	7751
4914	4913	5	Eastern Ward	1738
4915	4913	5	Southern Ward	2763
4916	4913	5	Town Ward	2348
4917	4913	5	Western Ward	902
4918	4879	4	Katete	8154
4919	4918	5	Kayanja	2337
4920	4918	5	Kishuro	1908
4921	4918	5	Nyakishojwa	1803
4922	4918	5	Nyarurambi	2106
4923	4879	4	Kayonza	22469
4924	4923	5	Bujengwe	11890
4925	4923	5	Karangara	6317
4926	4923	5	Rutendere	4262
4927	4879	4	Kayungwe	7410
4928	4927	5	Bukunga	1752
4929	4927	5	Katebere	1829
4930	4927	5	Mishenyi	2671
4931	4927	5	Nyakazinga	1158
4932	4879	4	Kihanda	5948
4933	4932	5	Bujerengye	1506
4934	4932	5	Nyakatoma	1506
4935	4932	5	Nyakibuga	858
4936	4932	5	Rwenkyende	2078
4937	4879	4	Kihembe	8273
4938	4937	5	Kashesha	1710
4939	4937	5	Kihembe	3748
4940	4937	5	Nyabirehe	2815
4941	4879	4	Kihiihi	22185
4942	4941	5	Kabuga	3157
4943	4941	5	Kibimbiri	12341
4944	4941	5	Rusoroza	6687
4945	4879	4	Kihiihi Town Council	28033
4946	4945	5	Bihomborwa Ward	6896
4947	4945	5	Kihiihi Town Ward	8712
4948	4945	5	Nyakatunguru Ward	7724
4949	4945	5	Rwanga Ward	4701
4950	4879	4	Kinaaba	7155
4951	4950	5	Kamakoma	1163
4952	4950	5	Kanyamatembe	1342
4953	4950	5	Kiziba	1467
4954	4950	5	Kyamukombe	909
4955	4950	5	Mukirwa	2274
4956	4879	4	Kirima	12204
4957	4956	5	Bushura	5153
4958	4956	5	Rubimbwa	2637
4959	4956	5	Rutugunda	4414
4960	4879	4	Kyeshero	7943
4961	4960	5	Bweronde	1492
4962	4960	5	Kashenyi	2627
4963	4960	5	Kyeshero	2122
4964	4960	5	Rugando	1702
4965	4879	4	Mpungu	13223
4966	4965	5	Buremba	3320
4967	4965	5	Mpungu	3882
4968	4965	5	Muramba	2270
4969	4965	5	Ngaara	3751
4970	4879	4	Nyakabungo Town Council	4507
4971	4970	5	Central Ward	1296
4972	4970	5	Eastern Ward	559
4973	4970	5	Northern Ward	1636
4974	4970	5	Southern Ward	1016
4975	4879	4	Nyakinoni	10044
4976	4975	5	Kanyambeho	2023
4977	4975	5	Karubeizi	3935
4978	4975	5	Nyakinoni	2087
4979	4975	5	Samaria	1999
4980	4879	4	Nyamirama	12460
4981	4980	5	Mashaku	1814
4982	4980	5	Ntungwa	1698
4983	4980	5	Nyakashure	2437
4984	4980	5	Nyarurambi	1182
4985	4980	5	Rushaka	5329
4986	4879	4	Nyamirama Town Council	10626
4987	4986	5	Eastern Ward	2801
4988	4986	5	Northern Ward	3706
4989	4986	5	Southern Ward	2039
4990	4986	5	Western Ward	2080
4991	4879	4	Nyanga	9871
4992	4991	5	Bukorwe	2803
4993	4991	5	Kamahe	2137
4994	4991	5	Nkunda	1972
4995	4991	5	Nyanga	2959
4996	4879	4	Rugyeyo	7075
4997	4996	5	Kashojwa	2560
4998	4996	5	Katungu	1273
4999	4996	5	Nyarurambi	3242
5000	4879	4	Rutenga	5122
5001	5000	5	Katojo	1630
5002	5000	5	Mafuga	1100
5003	5000	5	Muramba	2392
5004	4879	4	Rutenga Town Council	4023
5005	5004	5	Eastern Ward	1075
5006	5004	5	Northern Ward	850
5007	5004	5	Southern Ward	903
5008	5004	5	Western Ward	1195
5009	2	2	Kapchorwa	133621
5010	5009	3	Kapchorwa Municipality	54520
5011	5010	4	Central Division	14852
5012	5011	5	Barawa Ward	2297
5013	5011	5	Chemonges Ward	2646
5014	5011	5	Chepsikuroi Ward	3885
5015	5011	5	Kapsinda Ward	1601
5016	5011	5	Kawowo Ward	3057
5017	5011	5	Kokwomurya Ward	1366
5018	5010	4	East Division	15125
5019	5018	5	Kapchesiy Ward	1847
5020	5018	5	Kapchesombe Ward	1877
5021	5018	5	Kaplak Ward	1817
5022	5018	5	Kirwoko Ward	2177
5023	5018	5	Kween Ward	1933
5024	5018	5	Kwoti Ward	1331
5025	5018	5	Siron Ward	2576
5026	5018	5	Teryet Ward	1567
5027	5010	4	West Division	24543
5028	5027	5	Basar Ward	1890
5029	5027	5	Kabat Ward	2815
5030	5027	5	Kapenguria Ward	1392
5031	5027	5	Kapkwingi Ward	1494
5032	5027	5	Kapleko Ward	1775
5033	5027	5	Kapnyikew Ward	1658
5034	5027	5	Kapteret Ward	2386
5035	5027	5	Kaptul Ward	1582
5036	5027	5	Kululu Ward	1451
5037	5027	5	Kutung Ward	2181
5038	5027	5	Tegeres Ward	2488
5039	5027	5	Tongwo Ward	2393
5040	5027	5	Tuban Ward	1038
5041	5009	3	Tingey County	79101
5042	5041	4	Amukol	5216
5043	5042	5	Amukol	1034
5044	5042	5	Boron	1317
5045	5042	5	Kapcheboko	1054
5046	5042	5	Kapnongore	1082
5047	5042	5	Mariny	729
5048	5041	4	Chema	10420
5049	5048	5	Chebaser	1011
5050	5048	5	Chema	1869
5051	5048	5	Chemangang	1251
5052	5048	5	Chemosong	1256
5053	5048	5	Kabore	1396
5054	5048	5	Kapkwai	2284
5055	5048	5	Kwomo	1353
5056	5041	4	Chepterech	5426
5057	5056	5	Chepterech	1430
5058	5056	5	Chesoyen	1007
5059	5056	5	Kamoko	931
5060	5056	5	Kapsoyoy	1058
5061	5056	5	Rorok	1000
5062	5041	4	Gamogo	5950
5063	5062	5	Chebelat	835
5064	5062	5	Kapnarbaba	1323
5065	5062	5	Katongo	1157
5066	5062	5	Loch	707
5067	5062	5	Sulu	1928
5068	5041	4	Kabeywa	6131
5069	5068	5	Gubongoi	1448
5070	5068	5	Kabeywa	1206
5071	5068	5	Tangwen	1403
5072	5068	5	Tarito	614
5073	5068	5	Yembek	1460
5074	5041	4	Kapsinda	8124
5075	5074	5	Cheptuya	1452
5076	5074	5	Kapsabuko	1950
5077	5074	5	Kiring	981
5078	5074	5	Kongowo	2074
5079	5074	5	Sengwel	781
5080	5074	5	Tuyobei	886
5081	5041	4	Kaptanya	9967
5082	5081	5	Kaptokwoi	1642
5083	5081	5	Moron	2164
5084	5081	5	Ngangata	3637
5085	5081	5	Tumboboi	2524
5086	5041	4	Kaserem	6763
5087	5086	5	Cherubei	1257
5088	5086	5	Kaptono	1825
5089	5086	5	Ngesi	1425
5090	5086	5	Sirimityo	1253
5091	5086	5	Were	1003
5092	5041	4	Kawowo	8279
5093	5092	5	Chekwatit	1189
5094	5092	5	Kapchela	1551
5095	5092	5	Kimawa	1900
5096	5092	5	Kobil	1155
5097	5092	5	Reberwo	1399
5098	5092	5	Sanzara	1085
5099	5041	4	Munarya	6812
5100	5099	5	Chebonet	1439
5101	5099	5	Kapkwateny	1567
5102	5099	5	Munarya	1100
5103	5099	5	Ngasire	1137
5104	5099	5	Rakon	1569
5105	5041	4	Sipi	2500
5106	5105	5	Chepterit	1271
5107	5105	5	Gamatui	1229
5108	5041	4	Sipi Town Council	3513
5109	5108	5	Chekwanda Ward	1210
5110	5108	5	Kapkwirwok Town Ward	1139
5111	5108	5	Kapkwirwok Ward	1164
5112	2	2	Kapelebyong	143536
5113	5112	3	Kapelebyong County	143536
5114	5113	4	Acinga	5218
5115	5114	5	Acinga	902
5116	5114	5	Adepar	2212
5117	5114	5	Cula	699
5118	5114	5	Nyaikuro	437
5119	5114	5	Olet	968
5120	5113	4	Acowa	26600
5121	5120	5	Acowa	3647
5122	5120	5	Akum	7229
5123	5120	5	Amero	9220
5124	5120	5	Angerepo	4695
5125	5120	5	Angolebwal	1809
5126	5113	4	Acowa Town Council	5535
5127	5126	5	Acowa Ward	857
5128	5126	5	Akouetom Ward	1148
5129	5126	5	Aparisia Ward	960
5130	5126	5	Atumakasikou Ward	626
5131	5126	5	Oderai Ward	1944
5132	5113	4	Akore Town Council	3594
5133	5132	5	Central Ward	1187
5134	5132	5	Eastern Ward	704
5135	5132	5	Northern Ward	956
5136	5132	5	Southern Ward	747
5137	5113	4	Akoromit	18398
5138	5137	5	Akore	4486
5139	5137	5	Akoromit	1421
5140	5137	5	Aminito	4968
5141	5137	5	Kobuin	3448
5142	5137	5	Olekat	4075
5143	5113	4	Alito	10141
5144	5143	5	Akileng	2980
5145	5143	5	Alito	2069
5146	5143	5	Angica	1639
5147	5143	5	Iyalakwe	1551
5148	5143	5	Matilong	1902
5149	5113	4	Kapelebyong	22403
5150	5149	5	Amaseniko	3590
5151	5149	5	Amemia	4738
5152	5149	5	Atiira	4374
5153	5149	5	Nyada	4555
5154	5149	5	Okoboi	5146
5155	5113	4	Kapelebyong Town Council	7772
5156	5155	5	Acegerekuma Ward	2133
5157	5155	5	Kapelebyong Ward	1360
5158	5155	5	Nyakali Ward	632
5159	5155	5	Oderai Ward	866
5160	5155	5	Odukulu Ward	1568
5161	5155	5	Olobai Ward	1213
5162	5113	4	Obalanga	13175
5163	5162	5	Alupe	2238
5164	5162	5	Alwenya	1655
5165	5162	5	Labira	3630
5166	5162	5	Obalanga	2761
5167	5162	5	Opot	2891
5168	5113	4	Obalanga Town Council	4681
5169	5168	5	Ajesai Ward	1928
5170	5168	5	Central Ward	1736
5171	5168	5	India Ward	505
5172	5168	5	Okenyai Ward	512
5173	5113	4	Okungur	26019
5174	5173	5	Agonga	3498
5175	5173	5	Airabet	5385
5176	5173	5	Akodokodoi	4055
5177	5173	5	Amootom	5179
5178	5173	5	Aridai	4399
5179	5173	5	Odiding	3503
5180	3	2	Karenga	100375
5181	5180	3	Dodoth West County	74365
5182	5181	4	Kakwanga	4131
5183	5182	5	Kakwanga	1103
5184	5182	5	Lomaler	1319
5185	5182	5	Naesekapel	1709
5186	5181	4	Kapedo	5991
5187	5186	5	Komolicher	5991
5188	5181	4	Kapedo Town Council	10803
5189	5188	5	Kalimon Ward	3748
5190	5188	5	Kapedo Ward	5486
5191	5188	5	Nakorichokei Ward	1569
5192	5181	4	Kawalakol	21615
5193	5192	5	Kawalakol	4062
5194	5192	5	Kokoro	3873
5195	5192	5	Lomanok	3982
5196	5192	5	Lomej/natiira	1940
5197	5192	5	Naoyagum	3828
5198	5192	5	Naseperwae	3930
5199	5181	4	Lobalangit	21456
5200	5199	5	Lobalangit	4266
5201	5199	5	Lodapal	2640
5202	5199	5	Longoletyaanga	1801
5203	5199	5	Nakellio	4158
5204	5199	5	Pire	3640
5205	5199	5	Sarachom	4951
5206	5181	4	Sangar	10369
5207	5206	5	Kocholo	1940
5208	5206	5	Kumet	1543
5209	5206	5	Lokial	1621
5210	5206	5	Nakitemyet	1909
5211	5206	5	Sangar	3356
5212	5180	3	Napore West County	26010
5213	5212	4	Karenga	5167
5214	5213	5	Loyoro/napore	2766
5215	5213	5	Nakitoit	2401
5216	5212	4	Karenga Town Council	12892
5217	5216	5	Kangole Ward	4871
5218	5216	5	Karenga Ward	3255
5219	5216	5	Kathil Ward	2171
5220	5216	5	New Karenga Ward	2595
5221	5212	4	Kidepo Town Council	2035
5222	5221	5	Kidepo Ward	18
5223	5221	5	Kikiss Ward	176
5224	5221	5	Kokolio Ward	65
5225	5221	5	Nakidiir Ward	1446
5226	5221	5	Nataba Ward	330
5227	5212	4	Lokori	5916
5228	5227	5	Lokori	2296
5229	5227	5	Opotipot	3620
5230	4	2	Kasese	853831
5231	5230	3	Bukonjo County	396895
5232	5231	4	Bwera	21133
5233	5232	5	Bunyiswa	4143
5234	5232	5	Kisaka	5277
5235	5232	5	Kyogha	7124
5236	5232	5	Rwenguba	4589
5237	5231	4	Ihandiro	13593
5238	5237	5	Bubotyo	1346
5239	5237	5	Buhatiro	3312
5240	5237	5	Ihango	3357
5241	5237	5	Kihoko	2587
5242	5237	5	Kikyo	2991
5243	5231	4	Isango	10142
5244	5243	5	Harukungu	2348
5245	5243	5	Kabafu	2759
5246	5243	5	Kamukumbi	1160
5247	5243	5	Kayembe	1538
5248	5243	5	Kyempara	2337
5249	5231	4	Karambi	38130
5250	5249	5	Bikunya	2610
5251	5249	5	Buhuna	4623
5252	5249	5	Kamasasa	9299
5253	5249	5	Karambi	7824
5254	5249	5	Kisolholho	5720
5255	5249	5	Kithuti	8054
5256	5231	4	Kinyameseke Town Council	15976
5257	5256	5	Central Ward	5903
5258	5256	5	Kinyamaseke North Ward	2379
5259	5256	5	Kinyamaseke South Ward	2134
5260	5256	5	Mairukumi Ward	2244
5261	5256	5	Musomoro Ward	1386
5262	5256	5	Rwengaju Ward	1930
5263	5231	4	Kisinga	26480
5264	5263	5	Kagando	6778
5265	5263	5	Kajwenge	7128
5266	5263	5	Nsenyi	3930
5267	5263	5	Nyabirongo	8644
5268	5231	4	Kisinga Town Council	18653
5269	5268	5	Kagando Ward	7835
5270	5268	5	Kinywankoko Ward	1834
5271	5268	5	Nsenyi Ward	3134
5272	5268	5	Nyabirongo Ward	2220
5273	5268	5	Rwenguhyo Ward	3630
5274	5231	4	Kitabu	21210
5275	5274	5	Kabimba	3658
5276	5274	5	Kabirizi	4864
5277	5274	5	Kinyaminagha	3697
5278	5274	5	Kitabu	4115
5279	5274	5	Mughete	4876
5280	5231	4	Kitholu	14302
5281	5280	5	Kanyatsi	3633
5282	5280	5	Kiraro	4093
5283	5280	5	Kithobira	437
5284	5280	5	Kitholu	3714
5285	5280	5	Kyabikere	2425
5286	5231	4	Kithoma-Kanyatsi Town Council	4695
5287	5286	5	Isango Central Ward	673
5288	5286	5	Kanyatsi Ward	1030
5289	5286	5	Kathembo Ward	1039
5290	5286	5	Kithoma Ward	450
5291	5286	5	Kyabikere Ward	1503
5292	5231	4	Kyarumba	15785
5293	5292	5	Buthale	2238
5294	5292	5	Kaghema	2827
5295	5292	5	Kalonge	3603
5296	5292	5	Kanyatsi	3721
5297	5292	5	Kihungu	3396
5298	5231	4	Kyarumba Town Council	7431
5299	5298	5	Kabughabugha Ward	2902
5300	5298	5	Kyarumba Ward	3180
5301	5298	5	Nyakeya Ward	1349
5302	5231	4	Kyondo	27732
5303	5302	5	Buyagha	7511
5304	5302	5	Ibimbo	5244
5305	5302	5	Kanyatsi	9514
5306	5302	5	Kasokero	5463
5307	5231	4	Mahango	17269
5308	5307	5	Kyabwenge	3042
5309	5307	5	Lhuhiri	4376
5310	5307	5	Mahango	6008
5311	5307	5	Nyamusule	3843
5312	5231	4	Mpondwe - Lhubiriha Town Council	65539
5313	5312	5	Bwera Ward	6171
5314	5312	5	Kabuyiri Ward	6733
5315	5312	5	Kambukamabwe Ward	6279
5316	5312	5	Kyambogho Ward	6190
5317	5312	5	Mpondwe Ward	10862
5318	5312	5	Nyabugando Ward	6761
5319	5312	5	Nyakahya Ward	6074
5320	5312	5	Nyamambuka Ward	5099
5321	5312	5	Rusese Ward	11370
5322	5231	4	Munkunyu	34687
5323	5322	5	Kabingo	5238
5324	5322	5	Kacungiro	11647
5325	5322	5	Kitsutsu	14896
5326	5322	5	Nyakatonzi	2906
5327	5231	4	Nyakatonzi	4691
5328	5327	5	Kamaruli	1394
5329	5327	5	Kisasa	881
5330	5327	5	Muruti	688
5331	5327	5	Nyamugasani	1728
5332	5231	4	Nyakiyumbu	39447
5333	5332	5	Bukangara	5595
5334	5332	5	Kaghorwe	10232
5335	5332	5	Katholu/katojo	6045
5336	5332	5	Kayanja	1590
5337	5332	5	Lyakirema	8975
5338	5332	5	Muhindi	3676
5339	5332	5	Nyakiyumbu	3334
5340	5230	3	Busongora County	323307
5341	5340	4	Bugoye	31202
5342	5341	5	Bugoye	8495
5343	5341	5	Ibanda	1893
5344	5341	5	Katooke	11182
5345	5341	5	Kibirizi	2672
5346	5341	5	Muhambo	6960
5347	5340	4	Buhuhira	19653
5348	5347	5	Bughendero	5776
5349	5347	5	Buhuhira	4808
5350	5347	5	Kasambya	3560
5351	5347	5	Kithoma	3491
5352	5347	5	Muhumuza	2018
5353	5340	4	Bwesumbu	27262
5354	5353	5	Bunyamurwa	5787
5355	5353	5	Bwesumbu	5177
5356	5353	5	Kasangali	6404
5357	5353	5	Kaswa	4399
5358	5353	5	Mbata	5495
5359	5340	4	Hima Town Council	17640
5360	5359	5	Karungibati Ward	2808
5361	5359	5	Kendahi Ward	7120
5362	5359	5	Kisenyi Ward	2223
5363	5359	5	Mowlem Ward	2796
5364	5359	5	Town Zone Ward	2693
5365	5340	4	Ibanda-Kyanya Town Council	19430
5366	5365	5	Ibanda Central Ward	4836
5367	5365	5	Ibanda Ward	3258
5368	5365	5	Kyanya Ward	5917
5369	5365	5	Nyakalengijyo Ward	5419
5370	5340	4	Kabatunda-Kirabaho Town Counci	10145
5371	5370	5	Busibi Ward	977
5372	5370	5	Butswa Ward	1873
5373	5370	5	Kabatunda Ward	2523
5374	5370	5	Karambi Ward	2046
5375	5370	5	Kirabaho Ward	1431
5376	5370	5	Mabwe Ward	1295
5377	5340	4	Kahokya	14190
5378	5377	5	Kahokya	3585
5379	5377	5	Kalhamya	2435
5380	5377	5	Kinyateke	2848
5381	5377	5	Murambi	3068
5382	5377	5	Rwabihungu	2254
5383	5340	4	Karusandara	17434
5384	5383	5	Kanamba	2995
5385	5383	5	Karusandara	8008
5386	5383	5	Kibuga	4108
5387	5383	5	Kyalanga	2323
5388	5340	4	Katwe - Kabatoro Town Council	7783
5389	5388	5	Kiganda Ward	2131
5390	5388	5	Kyakitale Ward	1438
5391	5388	5	Kyarukara Ward	1591
5392	5388	5	Rwenjubu Ward	960
5393	5388	5	Top Hill Ward	1663
5394	5340	4	Kilembe	9444
5395	5394	5	Bunyandiko	2596
5396	5394	5	Kalibo	2839
5397	5394	5	Kamusonge	830
5398	5394	5	Kibandama	1392
5399	5394	5	Kirimo	1787
5400	5340	4	Kitswamba	13942
5401	5400	5	Hima	3233
5402	5400	5	Kihyo	5713
5403	5400	5	Rugendabara	4996
5404	5340	4	Kitswamba Town Council	9361
5405	5404	5	Kihoko Ward	991
5406	5404	5	Kitswamba Central	1488
5407	5404	5	Kitswamba I	1026
5408	5404	5	Muhumuza Ward	1054
5409	5404	5	Murambi Ward	2177
5410	5404	5	Nyakabale Ward	1382
5411	5404	5	Nyanseke Ward	1243
5412	5340	4	Kyabarungira	6520
5413	5412	5	Kyabarungira	3222
5414	5412	5	Rwesande	3298
5415	5340	4	Lake Katwe	8831
5416	5415	5	Busunga	625
5417	5415	5	Hamukungu	2018
5418	5415	5	Kabirizi	1546
5419	5415	5	Kasenyi	1621
5420	5415	5	Katunguru	1909
5421	5415	5	Kikorongo	858
5422	5415	5	Mweya	254
5423	5340	4	Maliba	27278
5424	5423	5	Bikone	3027
5425	5423	5	Isule	8759
5426	5423	5	Katebe	2718
5427	5423	5	Kisanga	4013
5428	5423	5	Mubuku	1886
5429	5423	5	Nyabisusu	3936
5430	5423	5	Nyangorongo	2939
5431	5340	4	Maliba Town Council	9850
5432	5431	5	Kibumba Ward	1952
5433	5431	5	Mpumuro Square Ward	4683
5434	5431	5	Nyarukungu Calvert Ward	3215
5435	5340	4	Mbunga	6988
5436	5435	5	Bunyakalija	1699
5437	5435	5	Kabwe	771
5438	5435	5	Kyangumirya	1551
5439	5435	5	Mbunga	1262
5440	5435	5	Nyakazinga	1705
5441	5340	4	Mubuku Town Council	5581
5442	5441	5	Kikura Ward	1103
5443	5441	5	Kisojo Ward	1388
5444	5441	5	Mubuku Central Ward	3090
5445	5340	4	Muhokya	13642
5446	5445	5	Kibiri	6035
5447	5445	5	Kirembe	1082
5448	5445	5	Nyamirami	6525
5449	5340	4	Muhokya Town Council	10341
5450	5449	5	Busambu Ward	1490
5451	5449	5	Bwenanule Ward	2321
5452	5449	5	Kahendero Ward	2133
5453	5449	5	Kisenyi Ward	1243
5454	5449	5	Muhokya Ward	3154
5455	5340	4	Nyakabingo	6841
5456	5455	5	Bukumbia	1069
5457	5455	5	Kibalya	1299
5458	5455	5	Kyambogho	817
5459	5455	5	Kyapa	1695
5460	5455	5	Nyakabingo I	1961
5461	5340	4	Rugendabara-Kikongo Town Council	16956
5462	5461	5	Burambira Ward	3801
5463	5461	5	Kihogo Ward	3291
5464	5461	5	Kikongo Ward	2101
5465	5461	5	Kyangwale Ward	3861
5466	5461	5	Rugendabara Ward	3902
5467	5340	4	Rukoki	12993
5468	5467	5	Bughalitsa	3839
5469	5467	5	Buhaghura	4114
5470	5467	5	Kigoro I	5040
5471	5230	3	Kasese Municipality	133629
5472	5471	4	Bulembia Division	14112
5473	5472	5	Katiri Ward	2713
5474	5472	5	Kyanjuki Ward	3601
5475	5472	5	Namuhuga Ward	4824
5476	5472	5	Nyakabingo III Ward	2974
5477	5471	4	Central Division	48608
5478	5477	5	Base Camp Ward	3939
5479	5477	5	Kamaiba Ward	5835
5480	5477	5	Kirembe Ward	6955
5481	5477	5	Nyakabingo II Ward	11664
5482	5477	5	Railway Ward	17441
5483	5477	5	Town Centre Ward	2774
5484	5471	4	Nyamwamba Division	70909
5485	5484	5	Kanyangeya Ward	18860
5486	5484	5	Kihara Ward	2109
5487	5484	5	Kisanga Ward	5017
5488	5484	5	Nyakasanga I Ward	10004
5489	5484	5	Nyakasanga II Ward	12741
5490	5484	5	Nyakasanga III Ward	6000
5491	5484	5	Rukooki Ward	10396
5492	5484	5	Scheme Ward	5782
5493	1	2	Kassanda	314008
5494	5493	3	Bukuya County	112305
5495	5494	4	Bukuya	12354
5496	5495	5	Kasamba	2966
5497	5495	5	Kizibawo	4294
5498	5495	5	Namiryango	5094
5499	5494	4	Bukuya Town Council	26972
5500	5499	5	Bukuya Ward	14560
5501	5499	5	Kabosi	1911
5502	5499	5	Kabuyimba	1466
5503	5499	5	Kalaata Ward	6189
5504	5499	5	Nchwamazzi	2846
5505	5494	4	Kijjuna	24760
5506	5505	5	Bucooco	1735
5507	5505	5	Kalagala	4734
5508	5505	5	Kijjuna	3333
5509	5505	5	Kiryajoobyo	1419
5510	5505	5	Kyamulinga	2667
5511	5505	5	Lugingi	10872
5512	5494	4	Kitumbi	21410
5513	5512	5	Bulinimula	3756
5514	5512	5	Kamusenene	4106
5515	5512	5	Kitumbi	4680
5516	5512	5	Kiziika	4344
5517	5512	5	Mundadde	4524
5518	5494	4	Makokoto	8350
5519	5518	5	Bbira	1754
5520	5518	5	Bulyambidde	1527
5521	5518	5	Kawasa	1226
5522	5518	5	Kyabakade	1214
5523	5518	5	Makokoto	1758
5524	5518	5	Namakonkome	871
5525	5494	4	Mbirizi	18459
5526	5525	5	Buseregenyu	3402
5527	5525	5	Kigudde	2688
5528	5525	5	Kisiita	4118
5529	5525	5	Kyato	3858
5530	5525	5	Mbiriizi	4393
5531	5493	3	Kassanda County	201703
5532	5531	4	Kalwana	38074
5533	5532	5	Bweyongedde	6488
5534	5532	5	Ddalamba	4672
5535	5532	5	Kasaazi	4597
5536	5532	5	Kikandwa	6003
5537	5532	5	Kyabalanzi	2612
5538	5532	5	Lwabaza	4047
5539	5532	5	Mayirikiti	5011
5540	5532	5	Nakateete	4644
5541	5531	4	Kamuli	10887
5542	5541	5	Kamuli	3156
5543	5541	5	Kasambya	2222
5544	5541	5	Kyoga	2574
5545	5541	5	Lusaba	1545
5546	5541	5	Manyogaseka	1390
5547	5531	4	Kassanda	23277
5548	5547	5	Binikira	2059
5549	5547	5	Kamuli Njagala	3585
5550	5547	5	Kyanika	4222
5551	5547	5	Lwantale	3390
5552	5547	5	Maggwa	3145
5553	5547	5	Nabugondo	2754
5554	5547	5	Namabaale	4122
5555	5531	4	Kassanda Town Council	17239
5556	5555	5	Busengejjo Ward	2540
5557	5555	5	Central Ward	2345
5558	5555	5	Jjemba Ward	2253
5559	5555	5	Kitongo Ward	2209
5560	5555	5	Kyedikyo Ward	2127
5561	5555	5	Makonzi Ward	1454
5562	5555	5	Mirembe-Kaweesa Ward	1692
5563	5555	5	Namiringa Ward	2619
5564	5531	4	Kiganda	23206
5565	5564	5	Kamusenene	3577
5566	5564	5	Kasambya	745
5567	5564	5	Kayunga	4681
5568	5564	5	Kigalama	2183
5569	5564	5	Kinoni	3300
5570	5564	5	Kyojjomanyi	3914
5571	5564	5	Musozi	2173
5572	5564	5	Nsozinga	2633
5573	5531	4	Kiganda Town Council	21647
5574	5573	5	Kalamba Ward	2859
5575	5573	5	Kamusu Ward	2085
5576	5573	5	Kasambya Ward	2787
5577	5573	5	Kawungera Ward	1927
5578	5573	5	Kigalama Ward	1421
5579	5573	5	Kyakayanja Ward	784
5580	5573	5	Kyamusota Ward	2370
5581	5573	5	Nakabimba Ward	1576
5582	5573	5	Nakiduduma Ward	3432
5583	5573	5	Nsozinga Ward	2406
5584	5531	4	Manyogaseka	13886
5585	5584	5	Kawawa	2428
5586	5584	5	Kiteredde	1346
5587	5584	5	Kyabayima	1795
5588	5584	5	Kyayi	891
5589	5584	5	Lutunku	1913
5590	5584	5	Manyogaseka	2483
5591	5584	5	Myaliro	1656
5592	5584	5	Ndeeba	1374
5593	5531	4	Myanzi	22975
5594	5593	5	Kampiri	4567
5595	5593	5	Kasaana	4994
5596	5593	5	Kigalama	6057
5597	5593	5	Myanzi	7357
5598	5531	4	Nalutuntu	30512
5599	5598	5	Gambwa	6759
5600	5598	5	Kyakatebe	6757
5601	5598	5	Kyanamugera	7994
5602	5598	5	Nalutuntu	9002
5603	2	2	Katakwi	234332
5604	5603	3	Ngariam County	90360
5605	5604	4	Akoboi	16507
5606	5605	5	Akoboi	2364
5607	5605	5	Aleles	3899
5608	5605	5	Alukucok	2294
5609	5605	5	Dadas	3699
5610	5605	5	Lalei	1752
5611	5605	5	Okokoma	2499
5612	5604	4	Getom	13144
5613	5612	5	Abela	2388
5614	5612	5	Aboiboi	1878
5615	5612	5	Abwanget	1388
5616	5612	5	Ajesai	2091
5617	5612	5	Angorom	1567
5618	5612	5	Getom	1866
5619	5612	5	Olupe	1966
5620	5604	4	Katakwi	18819
5621	5620	5	Aliakamer	3970
5622	5620	5	Alogook	2807
5623	5620	5	Aparisa	1243
5624	5620	5	Apolin	2808
5625	5620	5	Katakwi	1935
5626	5620	5	Ocorimongin Town Board	1404
5627	5620	5	Olela	1740
5628	5620	5	Osudan	2912
5629	5604	4	Katakwi Town Council	7914
5630	5629	5	Eastern Ward	1056
5631	5629	5	Northern Ward	1296
5632	5629	5	Southern Ward	2692
5633	5629	5	Western Ward	2870
5634	5604	4	Ngariam	10827
5635	5634	5	Acanga	928
5636	5634	5	Adipala	1175
5637	5634	5	Akisim	1008
5638	5634	5	Amoru	569
5639	5634	5	Apeleun	821
5640	5634	5	Bisina	712
5641	5634	5	Kaikamosing	1916
5642	5634	5	Nyero	708
5643	5634	5	Okuso	858
5644	5634	5	Olupe	847
5645	5634	5	Olupe Town Board	485
5646	5634	5	Osobut	800
5647	5604	4	Okore	4567
5648	5647	5	Adugulu	819
5649	5647	5	Aminit	83
5650	5647	5	Keelim	1490
5651	5647	5	Okore	125
5652	5647	5	Opiananya	553
5653	5647	5	Pakwi	945
5654	5647	5	Rwatama	552
5655	5604	4	Palam	18582
5656	5655	5	Acanga	983
5657	5655	5	Aelenyang	1445
5658	5655	5	Alengo	1293
5659	5655	5	Aterai	334
5660	5655	5	Ngariam	1797
5661	5655	5	Ngariam Town Board	527
5662	5655	5	Odoot	2721
5663	5655	5	Odoot Town Board	812
5664	5655	5	Okwamomwar	2741
5665	5655	5	Olilim	1961
5666	5655	5	Olilim Town Board	950
5667	5655	5	Ounyai	1403
5668	5655	5	Palam	1615
5669	5603	3	Toroma County	84272
5670	5669	4	Amusia	9797
5671	5670	5	Abule	2874
5672	5670	5	Amusia	2626
5673	5670	5	Asuret	2038
5674	5670	5	Moru	2259
5675	5669	4	Angodingod	7243
5676	5675	5	Acuna	1606
5677	5675	5	Akisim	2165
5678	5675	5	Angodingod	1839
5679	5675	5	Atete	1633
5680	5669	4	Kapujan	17823
5681	5680	5	Akoboi	2777
5682	5680	5	Apapai Town Board	972
5683	5680	5	Ariet	2789
5684	5680	5	Kapujan	3182
5685	5680	5	Kokorio	2370
5686	5680	5	Orimai	3204
5687	5680	5	Osuguro	2529
5688	5669	4	Magoro	23026
5689	5688	5	Akisim	1830
5690	5688	5	Angisa	2113
5691	5688	5	Apeleun	2725
5692	5688	5	Kamenu	2054
5693	5688	5	Kanapa	2194
5694	5688	5	Kipinyang	1889
5695	5688	5	Omasia	2922
5696	5688	5	Opeta	2041
5697	5688	5	Oriau	2062
5698	5688	5	Osudio	3196
5699	5669	4	Magoro Town Council	4236
5700	5699	5	Eastern Ward	1945
5701	5699	5	Obwangor Ward	1639
5702	5699	5	Southern Ward	652
5703	5669	4	Omodoi	6725
5704	5703	5	Adungulu	1104
5705	5703	5	Akoboi	1369
5706	5703	5	Aparisa	1604
5707	5703	5	Atirir	1561
5708	5703	5	Omodoi	1087
5709	5669	4	Toroma	11488
5710	5709	5	Agule	2164
5711	5709	5	Akurao	1931
5712	5709	5	Aleles	1261
5713	5709	5	Angirinyi	1452
5714	5709	5	Apuuton	1407
5715	5709	5	Ominya	2272
5716	5709	5	Toroma	1001
5717	5669	4	Toroma Town Council	3934
5718	5717	5	Atorom Obongut Ward	1103
5719	5717	5	Northern Ward	1276
5720	5717	5	Southern Ward	1555
5721	5603	3	Usuk County	59700
5722	5721	4	Guyaguya	12465
5723	5722	5	Aakum	3318
5724	5722	5	Adacar	2819
5725	5722	5	Guyaguya	2326
5726	5722	5	Orungo Town Board	1510
5727	5722	5	Toibong	2492
5728	5721	4	Okulonyo	11584
5729	5728	5	Angerepo	1909
5730	5728	5	Okocho	2973
5731	5728	5	Okuliak	2866
5732	5728	5	Okulonyo	1611
5733	5728	5	Omukuny	2225
5734	5721	4	Ongongoja	18153
5735	5734	5	Aketa	3319
5736	5734	5	Aketa Town Board	664
5737	5734	5	Akomotukoi	1894
5738	5734	5	Milmil	2204
5739	5734	5	Oburatum	1421
5740	5734	5	Obwobwo	1726
5741	5734	5	Okuda	2434
5742	5734	5	Ongatunyo	1335
5743	5734	5	Ongongoja	3156
5744	5721	4	Usuk	13150
5745	5744	5	Abwokodia	2899
5746	5744	5	Abyelut	1553
5747	5744	5	Cheleuko	3118
5748	5744	5	Okoritok	2913
5749	5744	5	Ongema	2667
5750	5721	4	Usuk Town Council	4348
5751	5750	5	Central Ward	2075
5752	5750	5	Northern Ward	1461
5753	5750	5	Southern Ward	812
5754	1	2	Kayunga	439175
5755	5754	3	Bbale County	185341
5756	5755	4	Bbaale	26267
5757	5756	5	Bbaale	7800
5758	5756	5	Kavule	4686
5759	5756	5	Kokotero	1798
5760	5756	5	Misanga	3638
5761	5756	5	Mugongo	4096
5762	5756	5	Nakitokolo	4249
5763	5755	4	Galiraya	33475
5764	5763	5	Galiraya	5851
5765	5763	5	Gwero-Namayuge	8608
5766	5763	5	Kasokwe	4943
5767	5763	5	Kirasa	4479
5768	5763	5	Namalere	4138
5769	5763	5	Ntimba	5456
5770	5755	4	Kayonza	74395
5771	5770	5	Balisanga	4474
5772	5770	5	Kafumba	6873
5773	5770	5	Kamusabi	10575
5774	5770	5	Kanywero	11973
5775	5770	5	Kitwe	9680
5776	5770	5	Nakyesanja	5293
5777	5770	5	Nakyessa	8617
5778	5770	5	Namaliri	7796
5779	5770	5	Namizo	9114
5780	5755	4	Kitimbwa	30263
5781	5780	5	Kitatya	4611
5782	5780	5	Kyerima	2778
5783	5780	5	Nakivubo	7384
5784	5780	5	Namulaba	5665
5785	5780	5	Nkokonjeru	7062
5786	5780	5	Wabwoko	2763
5787	5755	4	Kitimbwa Town Council	20941
5788	5787	5	Kyerima Ward	4892
5789	5787	5	Wabuyinja Ward	13410
5790	5787	5	Wabwoko Ward	2639
5791	5754	3	Ntenjeru County	253834
5792	5791	4	Busaana	38987
5793	5792	5	Kasana	3222
5794	5792	5	Kiwangula	7901
5795	5792	5	Lusenke	4737
5796	5792	5	Nabuganyi	4241
5797	5792	5	Namirembe	2905
5798	5792	5	Nampanyi	4873
5799	5792	5	Namukuma	4396
5800	5792	5	Namusaala	6712
5801	5791	4	Busaana Town Council	21635
5802	5801	5	Kasana Ward	8589
5803	5801	5	Lusenke Ward	3626
5804	5801	5	Namirembe Ward	6098
5805	5801	5	Namukuma Ward	3322
5806	5791	4	Kangulumira	27366
5807	5806	5	Kawoomya	8875
5808	5806	5	Kikwanya	3111
5809	5806	5	Seeta-Nyiize	15380
5810	5791	4	Kangulumira Town Council	37937
5811	5810	5	Kangulumira Ward	19958
5812	5810	5	Kigayaza Ward	4880
5813	5810	5	Nakatundu Ward	13099
5814	5791	4	Kayunga	47359
5815	5814	5	Bubajjwe	4675
5816	5814	5	Bukoloto	9386
5817	5814	5	Bukujju	4144
5818	5814	5	Busaale	3798
5819	5814	5	Buyobe	6236
5820	5814	5	Kiteredde	3912
5821	5814	5	Nakaseeta	4313
5822	5814	5	Nsotoka	10895
5823	5791	4	Kayunga Town Council	35617
5824	5823	5	Bukoloto Ward	8580
5825	5823	5	Kayunga Central Ward	4105
5826	5823	5	Namagabi Ward	7983
5827	5823	5	Ntenjeru Ward	6699
5828	5823	5	West/kibira Ward	8250
5829	5791	4	Nazigo	27993
5830	5829	5	Bukamba	5077
5831	5829	5	Katikanyonyi	3874
5832	5829	5	Kimanya	3641
5833	5829	5	Kirindi	6483
5834	5829	5	Natteta	2664
5835	5829	5	Nazigo	3871
5836	5829	5	Nsiima	2383
5837	5791	4	Nazigo Town Council	16940
5838	5837	5	Kimanya Ward	772
5839	5837	5	Natteta Ward	13133
5840	5837	5	Nazigo Ward	3035
5841	4	2	Kazo	208898
5842	5841	3	Kazo County	208898
5843	5842	4	Buremba Town Council	23182
5844	5843	5	Bigutsyo Ward	2521
5845	5843	5	Kabingo Ward	4184
5846	5843	5	Kakoni Ward	2385
5847	5843	5	Kijooha Ward	4327
5848	5843	5	Kitamba Ward	2840
5849	5843	5	Kyabahura Ward	3486
5850	5843	5	Ngomba Ward	3439
5851	5842	4	Burunga	25522
5852	5851	5	Burunga	5562
5853	5851	5	Kiguma	7292
5854	5851	5	Magondo	8578
5855	5851	5	Rwigi	4090
5856	5842	4	Engari	29846
5857	5856	5	Bishozi	2120
5858	5856	5	Engari	5495
5859	5856	5	Kakindo	3863
5860	5856	5	Kantaganya	5615
5861	5856	5	Keichumu	4542
5862	5856	5	Kyengando	4867
5863	5856	5	Nsheshe	3344
5864	5842	4	Kanoni	21142
5865	5864	5	Bwagonga	2619
5866	5864	5	Kitongore	3495
5867	5864	5	Mbogo	4376
5868	5864	5	Nyarubanga	4367
5869	5864	5	Rwakahaya	2576
5870	5864	5	Rwemengo	3709
5871	5842	4	Kazo	22238
5872	5871	5	Kayanga	6296
5873	5871	5	Mbaba	4411
5874	5871	5	Ntambazi	7353
5875	5871	5	Rwamuranga	4178
5876	5842	4	Kazo Town Council	18217
5877	5876	5	Byeshembe Ward	5853
5878	5876	5	Gabarungi Ward	2806
5879	5876	5	Kazo Ward	3157
5880	5876	5	Obwengara Ward	1745
5881	5876	5	Rwemirondo Ward	1602
5882	5876	5	Rwempiri Ward	3054
5883	5842	4	Kyampangara	12916
5884	5883	5	Akengyeya	2473
5885	5883	5	Ibaare	2756
5886	5883	5	Kyampangara	3068
5887	5883	5	Mushabwa	2691
5888	5883	5	Nyungu	1928
5889	5842	4	Migina	8955
5890	5889	5	Akatongore	2869
5891	5889	5	Kikoni	2734
5892	5889	5	Migina	3352
5893	5842	4	Nkungu	31008
5894	5893	5	Kagaramira	2706
5895	5893	5	Kagira	2986
5896	5893	5	Kajuzya	6971
5897	5893	5	Kataraza	4597
5898	5893	5	Nkungu	7793
5899	5893	5	Nshunga	5955
5900	5842	4	Rwemikoma	15872
5901	5900	5	Bugarihe	4811
5902	5900	5	Kijuma	5264
5903	5900	5	Rwemikoma	5797
5904	4	2	Kibaale	237649
5905	5904	3	Buyanja County	130917
5906	5905	4	Bubango	16133
5907	5906	5	Bubango	4305
5908	5906	5	Kigujju	2180
5909	5906	5	Rwega	9648
5910	5905	4	Bwamiramira	16874
5911	5910	5	Kahyoro	5631
5912	5910	5	Kibaali	2995
5913	5910	5	Kibingo	1618
5914	5910	5	Kikaada	4177
5915	5910	5	Kiribanga	2453
5916	5905	4	Kabasekende	16859
5917	5916	5	Bukonda	2357
5918	5916	5	Kabasekende	9505
5919	5916	5	Nyamugura	2522
5920	5916	5	Rwamagando	2475
5921	5905	4	Kibaale Town Council	9157
5922	5921	5	Kabalega Ward	1718
5923	5921	5	Kamurasi Ward	2711
5924	5921	5	Maasaza Ward	2620
5925	5921	5	Ruguuza Ward	2108
5926	5905	4	Kyakazihire	12555
5927	5926	5	Kacu	4877
5928	5926	5	Kyakazihire	2409
5929	5926	5	Maisuka	3493
5930	5926	5	Rwamagando	1776
5931	5905	4	Mugarama	23210
5932	5931	5	Imara	6786
5933	5931	5	Kezimbira	9075
5934	5931	5	Kituuma	3344
5935	5931	5	Mugarama	4005
5936	5905	4	Nyamarunda	22498
5937	5936	5	Bujogoro	11003
5938	5936	5	Kibogo	4564
5939	5936	5	Kyanyi	5030
5940	5936	5	Nyamarunda	1901
5941	5905	4	Nyamarunda Town Council	13631
5942	5941	5	Kateete Ward	3665
5943	5941	5	Kibeedi Ward	2272
5944	5941	5	Kitonezi Ward	3554
5945	5941	5	Nyamarunda Ward	4140
5946	5904	3	Buyanja East County	106732
5947	5946	4	Karama	18008
5948	5947	5	Bucuhya	5099
5949	5947	5	Kisindizi	2896
5950	5947	5	Kitutu	4672
5951	5947	5	Nkenda	5341
5952	5946	4	Kasimbi	13754
5953	5952	5	Kasozi	3855
5954	5952	5	Kicunda	3720
5955	5952	5	Kihebeba	3526
5956	5952	5	Manyinya	2653
5957	5946	4	Kayanja	10373
5958	5957	5	Kasenyi	2849
5959	5957	5	Kayanja	3610
5960	5957	5	Kisojo	1863
5961	5957	5	Wantema	2051
5962	5946	4	Kyebando	14233
5963	5962	5	Kirasa	4104
5964	5962	5	Kisalizi	1629
5965	5962	5	Kiyanja	3043
5966	5962	5	Mutagata	3775
5967	5962	5	Rusenke	1682
5968	5946	4	Matale	18151
5969	5968	5	Kaisekenkere	5138
5970	5968	5	Karangara	5914
5971	5968	5	Kitaba	5052
5972	5968	5	Kitengeto	2047
5973	5946	4	Nyamarwa	32213
5974	5973	5	Igoza	9560
5975	5973	5	Kamondo	4208
5976	5973	5	Kyakatwanga	6685
5977	5973	5	Nyamarwa	11760
5978	1	2	Kiboga	183255
5979	5978	3	Kiboga East County	97024
5980	5979	4	Bukomero	11181
5981	5980	5	Kibanda	1672
5982	5980	5	Kikooba	1923
5983	5980	5	Matagi	2694
5984	5980	5	Mwezi	2153
5985	5980	5	Sogolero	2739
5986	5979	4	Bukomero Town Council	17622
5987	5986	5	Kakunyu Ward	8893
5988	5986	5	Kateera Ward	4140
5989	5986	5	Kijjojolo Ward	1901
5990	5986	5	Mataagi Ward	2688
5991	5979	4	Ddwaniro	13192
5992	5991	5	Kakinzi	1747
5993	5991	5	Kalokola	4873
5994	5991	5	Katalama	3069
5995	5991	5	Lwankonge	3503
5996	5979	4	Kyomya	7876
5997	5996	5	Bulyankuyege	1109
5998	5996	5	Kagogo	1340
5999	5996	5	Kayunga	1927
6000	5996	5	Kyanamuyonjo	2254
6001	5996	5	Kyoomya	1246
6002	5979	4	Lwamata	12964
6003	6002	5	Kasejjere	4777
6004	6002	5	Kisagazi	4448
6005	6002	5	Nsala	3739
6006	5979	4	Lwamata Town Council	12870
6007	6006	5	Katanzige Ward	3155
6008	6006	5	Kawawa Ward	3608
6009	6006	5	Kitagenda Ward	3247
6010	6006	5	Lwamata Central Ward	2860
6011	5979	4	Muwanga	13106
6012	6011	5	Luswa	3356
6013	6011	5	Muwanga	2171
6014	6011	5	Nabwendo	5803
6015	6011	5	Wabinyira	1776
6016	5979	4	Nakasozi	8213
6017	6016	5	Bikko	1182
6018	6016	5	Kaakibwa	2631
6019	6016	5	Nakasengere	1779
6020	6016	5	Nakasozi	1119
6021	6016	5	Nakigga	1502
6022	5978	3	Kiboga West County	86231
6023	6022	4	Kapeke	16027
6024	6023	5	Kagobe	2743
6025	6023	5	Kasega	8641
6026	6023	5	Kyayimba	2432
6027	6023	5	Nyamiringa	2211
6028	6022	4	Kayera	3542
6029	6028	5	Kabuye	679
6030	6028	5	Kindeke	1515
6031	6028	5	Kyamukweya	1348
6032	6022	4	Kibiga	17201
6033	6032	5	Gogonya	1739
6034	6032	5	Kajjere	5399
6035	6032	5	Kibaale	4161
6036	6032	5	Kibiga	2071
6037	6032	5	Kizinga	3831
6038	6022	4	Kiboga Town Council	26677
6039	6038	5	Bamusuuta Ward	8376
6040	6038	5	Buzibweera Ward	5780
6041	6038	5	Kiboga Town Ward	5239
6042	6038	5	Kirulumba Ward	7282
6043	6022	4	Kyekumbya	10246
6044	6043	5	Buninga	2604
6045	6043	5	Kisweka	2468
6046	6043	5	Kyekumbya	3051
6047	6043	5	Ssinde	2123
6048	6022	4	Nkandwa	12538
6049	6048	5	Degeya	2567
6050	6048	5	Kalyango	3217
6051	6048	5	Kiryankozi	2539
6052	6048	5	Nkandwa	4215
6053	2	2	Kibuku	249441
6054	6053	3	Kabweri County	133294
6055	6054	4	Bulangira	5747
6056	6055	5	Kautukwi	1701
6057	6055	5	Pulaka	4046
6058	6054	4	Bulangira Town Council	9353
6059	6058	5	Bulangira Ward	2329
6060	6058	5	Kadoto Ward	2744
6061	6058	5	Kakunyumunyu Ward	2366
6062	6058	5	Kangalaba Ward	1914
6063	6054	4	Goli Goli	12035
6064	6063	5	Goligoli	2130
6065	6063	5	Majala	3057
6066	6063	5	Nabulanghangha	1843
6067	6063	5	Nangaiza	3198
6068	6063	5	Yoyo	1807
6069	6054	4	Kabweri	6824
6070	6069	5	Kabweri	1730
6071	6069	5	Kasecha	1872
6072	6069	5	Komodo	1970
6073	6069	5	Nyadera	1252
6074	6054	4	Kadama	4680
6075	6074	5	Dodoi	2379
6076	6074	5	Pedulu	2301
6077	6054	4	Kadama Town Council	10366
6078	6077	5	Kadama Ward	6217
6079	6077	5	Kawami Ward	1227
6080	6077	5	Nabunyere Ward	2922
6081	6054	4	Kagumu	21778
6082	6081	5	Kagumu	4975
6083	6081	5	Kamolokini	3386
6084	6081	5	Nabuli	4435
6085	6081	5	Nakitende	3634
6086	6081	5	Nakoma	2867
6087	6081	5	Nankokoli	2481
6088	6054	4	Kakutu	13459
6089	6088	5	Bumbante	2798
6090	6088	5	Kakubeke	2393
6091	6088	5	Kakutu	3387
6092	6088	5	Lyama	4881
6093	6054	4	Kenkebu	13168
6094	6093	5	Bulyawita	2491
6095	6093	5	Busiginyi	1635
6096	6093	5	Kagoli	2205
6097	6093	5	Katakopa	1362
6098	6093	5	Kenkebu	1610
6099	6093	5	Kitende	1653
6100	6093	5	Molokochomo	2212
6101	6054	4	Kirika	12134
6102	6101	5	Buluya	2964
6103	6101	5	Kirika	2499
6104	6101	5	Mikombe	3494
6105	6101	5	Saala	3177
6106	6054	4	Nabiswa	14463
6107	6106	5	Kabusule	4582
6108	6106	5	Kajoko	3343
6109	6106	5	Nabiswa	3132
6110	6106	5	Nampiido	3406
6111	6054	4	Nandere	9287
6112	6111	5	Bulabya	1762
6113	6111	5	Buluba	1512
6114	6111	5	Katyaime	1737
6115	6111	5	Mavungo	1717
6116	6111	5	Nandere	2559
6117	6053	3	Kibuku County	116147
6118	6117	4	Buseta	10357
6119	6118	5	Bukamugewo	1960
6120	6118	5	Bunghole	2734
6121	6118	5	Buseta	2177
6122	6118	5	Natoto	3486
6123	6117	4	Kasasira	9682
6124	6123	5	Buchera	2728
6125	6123	5	Bugiri	3562
6126	6123	5	Moru	3392
6127	6117	4	Kasasira Town Council	6347
6128	6127	5	Kasasira Central Ward	2346
6129	6127	5	Kasasira Ward	1489
6130	6127	5	Kasasira West Ward	1443
6131	6127	5	Nagongha Ward	1069
6132	6117	4	Kibuku	16060
6133	6132	5	Buminza	4114
6134	6132	5	Kanyolo	3153
6135	6132	5	Minyani	3261
6136	6132	5	Nadoto	2029
6137	6132	5	Nalubembe	3503
6138	6117	4	Kibuku Town Council	10026
6139	6138	5	Bubera Ward	3364
6140	6138	5	Kibuku Ward	2188
6141	6138	5	Kobolwa Ward	2208
6142	6138	5	Namawondo Ward	2266
6143	6117	4	Kituti	9519
6144	6143	5	Bubulanga	3483
6145	6143	5	Bukatikoko	1895
6146	6143	5	Katiryo	2210
6147	6143	5	Kituti	1931
6148	6117	4	Lwatama	17131
6149	6148	5	Kiryolo	4755
6150	6148	5	Lwatama	5281
6151	6148	5	Namuyonga	2720
6152	6148	5	Nanoko	4375
6153	6117	4	Nankodo	12105
6154	6153	5	Bukenye	3274
6155	6153	5	Bwikomba	3585
6156	6153	5	Kapyani	3038
6157	6153	5	Nankodo	2208
6158	6117	4	Tirinyi	8362
6159	6158	5	Kalampete	1934
6160	6158	5	Kataka	2491
6161	6158	5	Kotolo	1975
6162	6158	5	Saala	1962
6163	6117	4	Tirinyi Town Council	16558
6164	6163	5	Bugwere Ward	2220
6165	6163	5	Bukatikoko Ward	2265
6166	6163	5	Kitantalo Ward	3116
6167	6163	5	Kiyalyo Ward	3014
6168	6163	5	Kujji Ward	2632
6169	6163	5	Tirinyi Ward	3311
6170	4	2	Kikuube	379547
6171	6170	3	Buhaguzi County	289170
6172	6171	4	Kabwoya	70636
6173	6172	5	Bubogo	18920
6174	6172	5	Igwanjura	12082
6175	6172	5	Kaseeta	19817
6176	6172	5	Kimbugu	13385
6177	6172	5	Nkondo	6432
6178	6171	4	Kikuube Town Council	17173
6179	6178	5	Bulimya Ward	4609
6180	6178	5	Kamusunsi Ward	2656
6181	6178	5	Kigorra Ward	4974
6182	6178	5	Kisambo Ward	4934
6183	6171	4	Kiziranfumbi	32707
6184	6183	5	Bulimya	4771
6185	6183	5	Kidoma	11667
6186	6183	5	Munteme	16269
6187	6171	4	Kyangwali	96556
6188	6187	5	Buhuka	8436
6189	6187	5	Butoole	55920
6190	6187	5	Kasonga	12451
6191	6187	5	Kyangwali	19749
6192	6171	4	Kyangwali Rsc	72098
6193	6192	5	Bukanga	455
6194	6192	5	Bukinda	1741
6195	6192	5	Buyanja	2050
6196	6192	5	Kagoma	6479
6197	6192	5	Karuhinda	4677
6198	6192	5	Kasonga	4094
6199	6192	5	Kavule	1666
6200	6192	5	Kentomi	6015
6201	6192	5	Kijubwe	742
6202	6192	5	Kilima	1533
6203	6192	5	Kinakyeitaka	2016
6204	6192	5	Kirokole	1077
6205	6192	5	Kyebitaka	8622
6206	6192	5	Malembo	3916
6207	6192	5	Mombasa	4124
6208	6192	5	Mukarange	3328
6209	6192	5	Mukunyu A	891
6210	6192	5	Mukunyu B	830
6211	6192	5	Mulumba	938
6212	6192	5	Munsisa A	1212
6213	6192	5	Munsisa B	1569
6214	6192	5	Namakakale	798
6215	6192	5	Ngurwe	687
6216	6192	5	Nyabitete	2897
6217	6192	5	Nyambogo	2404
6218	6192	5	Nyamiganda	3284
6219	6192	5	Nyampindu	1044
6220	6192	5	Rwenyawawa	977
6221	6192	5	Waibuga	2032
6222	6170	3	Buhaguzi East County	90377
6223	6222	4	Bugambe	37951
6224	6223	5	Bugambe	5263
6225	6223	5	Katanga	15924
6226	6223	5	Nyarugabu	4645
6227	6223	5	Ruguse	12119
6228	6222	4	Buhimba	39811
6229	6228	5	Kinogozi	9737
6230	6228	5	Kyabatalya	3464
6231	6228	5	Musaija-Mukuru East	9912
6232	6228	5	Musaija-Mukuru West	5884
6233	6228	5	Ruhunga	10814
6234	6222	4	Buhimba Town Council	12615
6235	6234	5	Buhimba East Ward	3850
6236	6234	5	Buhimba West Ward	4138
6237	6234	5	Kigaaya East Ward	1220
6238	6234	5	Kigaaya West Ward	3407
6239	4	2	Kiruhura	203502
6240	6239	3	Kashongi County	53640
6241	6240	4	Kashongi	35443
6242	6241	5	Byanamira	7461
6243	6241	5	Kabushwere	6553
6244	6241	5	Kashongi	2771
6245	6241	5	Kitabo	6917
6246	6241	5	Ntarama	3637
6247	6241	5	Rwanyangwe	5661
6248	6241	5	Rwenjubu	2443
6249	6240	4	Kitura	18197
6250	6249	5	Bweeza	3779
6251	6249	5	Kigando	2536
6252	6249	5	Kitura	2560
6253	6249	5	Mooya	3357
6254	6249	5	Nyaburunga	3494
6255	6249	5	Rwemamba	2471
6256	6239	3	Nyabushozi County	149862
6257	6256	4	Akayanja	9661
6258	6257	5	Akayanja	1879
6259	6257	5	Nombe II	2213
6260	6257	5	Nyankumba	2277
6261	6257	5	Rushororo	1975
6262	6257	5	Rwakobo	1317
6263	6256	4	Kanyaryeru	8397
6264	6263	5	Akaku	1526
6265	6263	5	Kanyaryeru Res Sch	1063
6266	6263	5	Kibega	2388
6267	6263	5	Rwamuranda	3420
6268	6256	4	Kenshunga	14704
6269	6268	5	Nyakasharara	6886
6270	6268	5	Rugongi	7818
6271	6256	4	Kikatsi	12126
6272	6271	5	Embare	5513
6273	6271	5	Kayonza	4205
6274	6271	5	Keikoti	2408
6275	6256	4	Kinoni	19482
6276	6275	5	Kaitanturegye	4933
6277	6275	5	Kasaana	6999
6278	6275	5	Macuncu	7550
6279	6256	4	Kiruhura Town Council	7963
6280	6279	5	Kashwa Ward	4066
6281	6279	5	Kiruhura Ward	1145
6282	6279	5	Nyakasharara Ward	2752
6283	6256	4	Nyakashashara	19459
6284	6283	5	Bijubwe	3702
6285	6283	5	Kyakabunga	5970
6286	6283	5	Nyakahita	5911
6287	6283	5	Rurambira	3876
6288	6256	4	Rushere Town Council	18775
6289	6288	5	Akatongore Ward	3930
6290	6288	5	Mugore Ward	1292
6291	6288	5	Nshwerenkye Ward	4386
6292	6288	5	Nswereempango Ward	4599
6293	6288	5	Rushere Ward	4568
6294	6256	4	Rwenshande	10506
6295	6294	5	Akabaare	3534
6296	6294	5	Ifura	4045
6297	6294	5	Kanyanya	2927
6298	6256	4	Rwetamu	9608
6299	6298	5	Akajumbura	2745
6300	6298	5	Bugweiraro	1796
6301	6298	5	Kanitsya	948
6302	6298	5	Rwetamu	4119
6303	6256	4	Sanga	6534
6304	6303	5	Nombe I	573
6305	6303	5	Rwabarata	2379
6306	6303	5	Rwamuhuku	3582
6307	6256	4	Sanga Town Council	12647
6308	6307	5	Ekizimbi Ward	2457
6309	6307	5	Nkongoro Ward	2556
6310	6307	5	Nombe Ward	2160
6311	6307	5	Sanga Ward	5474
6312	4	2	Kiryandongo	364872
6313	6312	3	Kibanda North County	270897
6314	6313	4	Bweyale Town Council	58489
6315	6314	5	Central Ward	34094
6316	6314	5	Northern Ward	9717
6317	6314	5	Southern Ward	14678
6318	6313	4	Diima	14453
6319	6318	5	Diima	6474
6320	6318	5	Okwece	7979
6321	6313	4	Karuma Town Council	15086
6322	6321	5	Central Ward	6371
6323	6321	5	Northern Ward	5535
6324	6321	5	Southern Ward	3180
6325	6313	4	Kichwabugingo	32933
6326	6325	5	Chope Lwor	9701
6327	6325	5	Karungu	10327
6328	6325	5	Kichwabugingo	6677
6329	6325	5	Nyinga	6228
6330	6313	4	Kiryandongo	36979
6331	6330	5	Kibeka	7899
6332	6330	5	Kikube	10575
6333	6330	5	Kitwara	8299
6334	6330	5	Kyembera	10206
6335	6313	4	Kiryandongo Refugee Camp	30074
6336	6335	5	Ranch I	8859
6337	6335	5	Ranch Xviii	4074
6338	6335	5	Ranch Xxxvii	17141
6339	6313	4	Kiryandongo Town Council	7136
6340	6339	5	Northern Ward	4353
6341	6339	5	Southern Ward	2783
6342	6313	4	Kyankende	23525
6343	6342	5	Diika	8183
6344	6342	5	Kahara	5900
6345	6342	5	Kyankende	9442
6346	6313	4	Mutunda	19655
6347	6346	5	Kakwokwo	10516
6348	6346	5	Kimogoro	5138
6349	6346	5	Panyadoli	4001
6350	6313	4	Nyamahasa	32567
6351	6350	5	Alero	7230
6352	6350	5	Laboke	6731
6353	6350	5	Nanda	10947
6354	6350	5	Nyamahasa	7659
6355	6312	3	Kibanda South County	93975
6356	6355	4	Kigumba	37162
6357	6356	5	Buhoomozi	7272
6358	6356	5	Kigumba	11604
6359	6356	5	Kiigya	9394
6360	6356	5	Mpumwe	8892
6361	6355	4	Kigumba Town Council	24835
6362	6361	5	Ward A	7898
6363	6361	5	Ward B	9751
6364	6361	5	Ward C	7186
6365	6355	4	Masindi Port	14266
6366	6365	5	Kaduku	4834
6367	6365	5	Kitukuza	3113
6368	6365	5	Waibango	3102
6369	6365	5	Wakisanyi	3217
6370	6355	4	Mboira	17712
6371	6370	5	Apodorwa	5495
6372	6370	5	Kifuruta	3867
6373	6370	5	Mboira	4496
6374	6370	5	Nyakabale	3854
6375	4	2	Kisoro	433662
6376	6375	3	Bufumbira County	302831
6377	6376	4	Bunagana Town Council	15547
6378	6377	5	Bunagana Ward	4934
6379	6377	5	Gasasa Ward	2783
6380	6377	5	Gitowa Ward	2780
6381	6377	5	Maziba Ward	5050
6382	6376	4	Busanza	16721
6383	6382	5	Buhozi	9574
6384	6382	5	Buhumbu	7147
6385	6376	4	Chahafi Town Council	16355
6386	6385	5	Central Ward	4637
6387	6385	5	North Ward	6321
6388	6385	5	South Ward	5397
6389	6376	4	Chahi	18393
6390	6389	5	Muganza	5474
6391	6389	5	Nyakabingo	7565
6392	6389	5	Rutare	5354
6393	6376	4	Cyanika Town Council	10725
6394	6393	5	Kinyababa Ward	2495
6395	6393	5	Kirimbiro Ward	2987
6396	6393	5	Rukoro Ward	5243
6397	6376	4	Kanaba	24872
6398	6397	5	Kagezi	11963
6399	6397	5	Muhindura	12909
6400	6376	4	Mupaka Town Council	11773
6401	6400	5	Bugara Ward	5070
6402	6400	5	Central Ward	2986
6403	6400	5	Kaburasazi Ward	3717
6404	6376	4	Muramba	36136
6405	6404	5	Gisozi	12259
6406	6404	5	Muramba	12178
6407	6404	5	Sooko	11699
6408	6376	4	Murora	14395
6409	6408	5	Biizi	5396
6410	6408	5	Chibumba	4481
6411	6408	5	Karago	4518
6412	6376	4	Nyakabande	38287
6413	6412	5	Gasiza	10647
6414	6412	5	Gisorora	16699
6415	6412	5	Rwingwe	10941
6416	6376	4	Nyakinama	27875
6417	6416	5	Chihe	8860
6418	6416	5	Mbuga	4453
6419	6416	5	Rwaramba	14562
6420	6376	4	Nyarubuye	19067
6421	6420	5	Busengo	9484
6422	6420	5	Karambi	9583
6423	6376	4	Nyarusiza	43081
6424	6423	5	Gasovu	10481
6425	6423	5	Gitenderi	12333
6426	6423	5	Mabungo	10132
6427	6423	5	Rukongi	10135
6428	6376	4	Rukundo Town Council	9604
6429	6428	5	Northern Ward	4282
6430	6428	5	Southern Ward	5322
6431	6375	3	Bukimbiri County	104142
6432	6431	4	Bukimbiri	8138
6433	6432	5	Kagunga	4251
6434	6432	5	Rugarama	3887
6435	6431	4	Kirundo	12646
6436	6435	5	Kasharara	4258
6437	6435	5	Kibugu	5089
6438	6435	5	Rutaka	3299
6439	6431	4	Nkuringo Town Council	18511
6440	6439	5	Kahurire A Ward	4385
6441	6439	5	Kahurire B Ward	4761
6442	6439	5	Kikobero Ward	3200
6443	6439	5	Murore Ward	3295
6444	6439	5	Nteko Ward	2870
6445	6431	4	Nyabwishenya	9383
6446	6445	5	Bitare	2912
6447	6445	5	Gasovu	3699
6448	6445	5	Nyarutembe	2772
6449	6431	4	Nyanamo Town Council	16754
6450	6449	5	Butengo Ward	3598
6451	6449	5	Kashenyi Ward	2593
6452	6449	5	Kigyeyo Ward	2589
6453	6449	5	Nyamiyaga Ward	3275
6454	6449	5	Rugongwe	4699
6455	6431	4	Nyundo	19126
6456	6455	5	Bubuye	4028
6457	6455	5	Nyundo	15098
6458	6431	4	Rubuguri Town Council	19584
6459	6458	5	Kashija Ward	4690
6460	6458	5	Nombe Ward	6585
6461	6458	5	Nyabaremura Ward	3238
6462	6458	5	Rushaga Ward	5071
6463	6375	3	Kisoro Municipality	26689
6464	6463	4	Central Division	7429
6465	6464	5	Central Ward	4231
6466	6464	5	Nyamagana Ward	3198
6467	6463	4	North Division	8223
6468	6467	5	Kamonyi Ward	4357
6469	6467	5	Nyagashinge Ward	3866
6470	6463	4	South Division	11037
6471	6470	5	Busamba Ward	3974
6472	6470	5	Gasiza Ward	3327
6473	6470	5	Hospital Ward	3736
6474	4	2	Kitagwenda	184947
6475	6474	3	Kitagwenda County	184947
6476	6475	4	Buhanda	17606
6477	6476	5	Bujumiro	2261
6478	6476	5	Kengeya	3699
6479	6476	5	Nyabihoko	5045
6480	6476	5	Nyakashenyi	6601
6481	6475	4	Bukurungo Town Council	7185
6482	6481	5	Buhumuriro Ward	1441
6483	6481	5	Bukurungu Ward	2541
6484	6481	5	Iharagatwa Ward	1821
6485	6481	5	Nyakeera Ward	1382
6486	6475	4	Kabujogera Town Council	14672
6487	6486	5	Kabujogera Ward	2775
6488	6486	5	Kagazi Ward	2956
6489	6486	5	Kantozi Ward	3690
6490	6486	5	Kikondo Ward	2357
6491	6486	5	Rwamasinde Ward	2894
6492	6475	4	Kakasi	13481
6493	6492	5	Iryangabi	2896
6494	6492	5	Kakasi	4631
6495	6492	5	Kanywambogo	1824
6496	6492	5	Kitaka	1430
6497	6492	5	Kitoma	2700
6498	6475	4	Kanara	18429
6499	6498	5	Kanara	4973
6500	6498	5	Kekubo	6217
6501	6498	5	Kigarama	4595
6502	6498	5	Rwenshama	2644
6503	6475	4	Kicheche	14091
6504	6503	5	Buryansungwe	2780
6505	6503	5	Bwera	3246
6506	6503	5	Kayanga	2496
6507	6503	5	Kigoto	3318
6508	6503	5	Kinyamugara	2251
6509	6475	4	Kitagwenda Town Council	24135
6510	6509	5	Kabale Ward	9398
6511	6509	5	Kicwamba North Ward	1322
6512	6509	5	Kicwamba Ward	3743
6513	6509	5	Kyotamushana Ward	3805
6514	6509	5	Ntara Ward	3846
6515	6509	5	Rwentuha Ward	2021
6516	6475	4	Mahyoro	10387
6517	6516	5	Kitonzi	3615
6518	6516	5	Nyakasura	6772
6519	6475	4	Mahyoro Town Council	17119
6520	6519	5	Kanyabikyere Ward	5018
6521	6519	5	Kyendagara Ward	5359
6522	6519	5	Mahyoro Ward	6742
6523	6475	4	Ntara	13403
6524	6523	5	Kitonzi	4607
6525	6523	5	Nyakacwamba	4644
6526	6523	5	Rugarama	4152
6527	6475	4	Nyabbani	17283
6528	6527	5	Kamayenje	4471
6529	6527	5	Muyenga	1477
6530	6527	5	Nganiko	2407
6531	6527	5	Nyabbani	2506
6532	6527	5	Rwenkubebe	3951
6533	6527	5	Rwesigiire	2471
6534	6475	4	Ruhunga	6437
6535	6534	5	Kibale	1935
6536	6534	5	Kyarwera	1909
6537	6534	5	Kyeganywa	1103
6538	6534	5	Ruhunga	1490
6539	6475	4	Rwenjaza	10719
6540	6539	5	Nyamabale	2424
6541	6539	5	Nyarurambi	2892
6542	6539	5	Rutooma	2411
6543	6539	5	Rwenjaza	2992
6544	3	2	Kitgum	239655
6545	6544	3	Chua East County	99759
6546	6545	4	Kiteny	8693
6547	6546	5	Kiteny	1996
6548	6546	5	Kwarayo	2846
6549	6546	5	Ladotonen	2054
6550	6546	5	Paluba	1797
6551	6545	4	Muchwini East	7787
6552	6551	5	Ogwapoke	2443
6553	6551	5	Okol	1570
6554	6551	5	Pubech	3774
6555	6545	4	Muchwini West	7860
6556	6555	5	Bura	2951
6557	6555	5	Pachua	1561
6558	6555	5	Pudo	3348
6559	6545	4	Mucwini	9024
6560	6559	5	Akara	2888
6561	6559	5	Pajong	3177
6562	6559	5	Yepa	2959
6563	6545	4	Namokora	4732
6564	6563	5	Diete	1570
6565	6563	5	Pugoda East	1233
6566	6563	5	Pugoda West	1929
6567	6545	4	Namokora North	6731
6568	6567	5	Kalabong	1604
6569	6567	5	Onyala	1894
6570	6567	5	Pagwok	1410
6571	6567	5	Palabolo	1823
6572	6545	4	Namokora Town Council	7332
6573	6572	5	Central Ward	1932
6574	6572	5	Katubbu Ward	1362
6575	6572	5	Ladwoggi Ward	2251
6576	6572	5	Wigweng Ward	1787
6577	6545	4	Omiya Anyima West	11490
6578	6577	5	Akobi	3982
6579	6577	5	Palameny	2315
6580	6577	5	Palwo	2661
6581	6577	5	Para	2532
6582	6545	4	Omiya-Anyima	13319
6583	6582	5	Melong	1625
6584	6582	5	Ogili	4733
6585	6582	5	Panyum	4150
6586	6582	5	Pella	2811
6587	6545	4	Orom	12804
6588	6587	5	Gule	1885
6589	6587	5	Karakelet	2123
6590	6587	5	Lolia	4858
6591	6587	5	Lolwa	2669
6592	6587	5	Lunganyura	1269
6593	6545	4	Orom East	9987
6594	6593	5	Akurumo	2835
6595	6593	5	Katwotwo	3819
6596	6593	5	Okuti	3333
6597	6544	3	Chua West County	89730
6598	6597	4	Akwang	18690
6599	6598	5	Lamit	6734
6600	6598	5	Lugwar	2156
6601	6598	5	Mura	2860
6602	6598	5	Pajimo	6940
6603	6597	4	Kitgum Matidi	10896
6604	6603	5	Lumule	3932
6605	6603	5	Oryanga B	3135
6606	6603	5	Paibony	3829
6607	6597	4	Kitgum Matidi Town Council	7702
6608	6607	5	Ibakara Ward	2076
6609	6607	5	Jerusalem Ward	870
6610	6607	5	Pagwa Ward	1715
6611	6607	5	Pakumu Ward	1317
6612	6607	5	Parwech Ward	1724
6613	6597	4	Labongo Amida West	9724
6614	6613	5	Koch	2344
6615	6613	5	Lamola	3930
6616	6613	5	Okidi	3450
6617	6597	4	Labongo Layamo	13301
6618	6617	5	Ocetoke	2909
6619	6617	5	Pagen	3827
6620	6617	5	Paibwor	3143
6621	6617	5	Pamolo	3422
6622	6597	4	Labongo-Amida	9277
6623	6622	5	Akworo	3845
6624	6622	5	Lukwor	3053
6625	6622	5	Oryang A	2379
6626	6597	4	Lagoro	10443
6627	6626	5	Akuna	1461
6628	6626	5	Buluzi	1214
6629	6626	5	Laber	1593
6630	6626	5	Labilo	2219
6631	6626	5	Pawidi	2320
6632	6626	5	Wigweng	1636
6633	6597	4	Lalano	9697
6634	6633	5	Aloto	3144
6635	6633	5	Balakwa	2389
6636	6633	5	Lakwor	2227
6637	6633	5	Lalano	1937
6638	6544	3	Kitgum Municipality	50166
6639	6638	4	Central Division	8750
6640	6639	5	Town Ward	1942
6641	6639	5	West Land Ward A	3426
6642	6639	5	West Land Ward B	3382
6643	6638	4	Pager Division	18617
6644	6643	5	Green Land Ward	7027
6645	6643	5	Pager Ward A	3879
6646	6643	5	Pager Ward B	4270
6647	6643	5	Pongdwongo Ward	3441
6648	6638	4	Pandwong Division	22799
6649	6648	5	Alango Ward	6479
6650	6648	5	Guu Ward A	4183
6651	6648	5	Guu Ward B	3219
6652	6648	5	Pandwong Ward	8918
6653	3	2	Koboko	271781
6654	6653	3	Koboko County	148455
6655	6654	4	Dranya	16116
6656	6655	5	Alla	3289
6657	6655	5	Aunga	4488
6658	6655	5	Ginyako	2614
6659	6655	5	Leiko	2941
6660	6655	5	Nyagazia	2784
6661	6654	4	Keri Town Council	7398
6662	6661	5	Kiakumiri Ward	3237
6663	6661	5	Luduri Ward	1453
6664	6661	5	Nyaragala Ward	1120
6665	6661	5	Nyokpa Ward	1588
6666	6654	4	Kuluba	48852
6667	6666	5	Ayipe	12071
6668	6666	5	Monodu	3208
6669	6666	5	Nyambiri	23626
6670	6666	5	Pamodo	9947
6671	6654	4	Lobule	31649
6672	6671	5	Ajipala	3755
6673	6671	5	Aliribu	4071
6674	6671	5	Lobule	5011
6675	6671	5	Lurujo	3725
6676	6671	5	Ombaci	3122
6677	6671	5	Padrombu	3536
6678	6671	5	Ponyura	2554
6679	6671	5	Tukaliri	2593
6680	6671	5	Yatua	3282
6681	6654	4	Midia	30977
6682	6681	5	Asunga	3428
6683	6681	5	Degiba	3575
6684	6681	5	Dricile	3260
6685	6681	5	Kingaba	3555
6686	6681	5	Lurunu	2668
6687	6681	5	Midia	14491
6688	6654	4	Oraba Town Council	13463
6689	6688	5	Angalua Ward	1247
6690	6688	5	Awindiri Ward	904
6691	6688	5	Kakanya Ward	1254
6692	6688	5	Nyoke Ward	2193
6693	6688	5	Romoni Ward	2449
6694	6688	5	Ropoli Ward	3725
6695	6688	5	Weke Ward	1691
6696	6653	3	Koboko Municipality	67727
6697	6696	4	North Division	21263
6698	6697	5	Ombaci Ward	9846
6699	6697	5	Teremunga Ward	4009
6700	6697	5	Triangle Ward	7408
6701	6696	4	South Division	26314
6702	6701	5	Abele Ward	6792
6703	6701	5	Apa Ward	4567
6704	6701	5	Mengo Ward	10278
6705	6701	5	Nyangilia Ward	4677
6706	6696	4	Western Division	20150
6707	6706	5	Amunupi Ward	1981
6708	6706	5	Godia Ward	10452
6709	6706	5	Isoko Ward	7717
6710	6653	3	Koboko North County	55599
6711	6710	4	Abuku	17386
6712	6711	5	Gborokolongo	3261
6713	6711	5	Metino	4081
6714	6711	5	Nyai	3438
6715	6711	5	Nyoricheku	3080
6716	6711	5	Onyokunga	3526
6717	6710	4	Ludara	38213
6718	6717	5	Bamure	3457
6719	6717	5	Chakulia	6707
6720	6717	5	Gurepi	4441
6721	6717	5	Kechi	2276
6722	6717	5	Lima	5306
6723	6717	5	Longira	2717
6724	6717	5	Ludara	6848
6725	6717	5	Nyajo	3774
6726	6717	5	Podo	2687
6727	3	2	Kole	294301
6728	6727	3	Kole North County	145516
6729	6728	4	Aboke	26387
6730	6729	5	Apach	10713
6731	6729	5	Apuru	4946
6732	6729	5	Opeta	10728
6733	6728	4	Aboke Town Council	29469
6734	6733	5	Akwirididi Ward	12583
6735	6733	5	Aweingwec Ward	6799
6736	6733	5	Eastern Ward	4332
6737	6733	5	Ogwangacuma Ward	5755
6738	6728	4	Alito	31342
6739	6738	5	Alito	1470
6740	6738	5	Amuge	5874
6741	6738	5	Apala	8524
6742	6738	5	Apiioguru	2922
6743	6738	5	Ayala-Oya	5297
6744	6738	5	Barongin	4314
6745	6738	5	Otkwach	2941
6746	6728	4	Alito Town Council	15434
6747	6746	5	Aker Ward	2998
6748	6746	5	Bua-Atyeno Ward	3789
6749	6746	5	Owani Adilo Ward	4318
6750	6746	5	Tekidi Ward	4329
6751	6728	4	Okwerodot	42884
6752	6751	5	Abongo Jok	2788
6753	6751	5	Adel-Logo	8292
6754	6751	5	Ayamo	5241
6755	6751	5	Ayara	4550
6756	6751	5	Lelakot	6544
6757	6751	5	Lwala	7288
6758	6751	5	Obutu	4171
6759	6751	5	Okwerodot	4010
6760	6727	3	Kole South County	148785
6761	6760	4	Akalo	15136
6762	6761	5	Abeli	7504
6763	6761	5	Bar-Akalo	7632
6764	6760	4	Akalo Town Council	23139
6765	6764	5	Eastern A Ward	6394
6766	6764	5	Eastern B Ward	4538
6767	6764	5	Western A Ward	5207
6768	6764	5	Western B Ward	7000
6769	6760	4	Ayer	41635
6770	6769	5	Abur	5667
6771	6769	5	Alemi	6802
6772	6769	5	Ilera	8769
6773	6769	5	Lwala	9071
6774	6769	5	Okwor	2500
6775	6769	5	Telela	8826
6776	6760	4	Bala	38734
6777	6776	5	Agege	10296
6778	6776	5	Amoilela	3637
6779	6776	5	Angic	4308
6780	6776	5	Aumi	5349
6781	6776	5	Bala	1087
6782	6776	5	Omoladyang	6928
6783	6776	5	Omuge	5049
6784	6776	5	Omwara	2080
6785	6760	4	Bala Town Council	19339
6786	6785	5	Eastern A Ward	4983
6787	6785	5	Eastern B Ward	4953
6788	6785	5	Western A Ward	5069
6789	6785	5	Western B Ward	4334
6790	6760	4	Kole Town Council	10802
6791	6790	5	Eastern Ward A	3478
6792	6790	5	Eastern Ward B	2774
6793	6790	5	Western Ward A	2009
6794	6790	5	Western Ward B	2541
6795	3	2	Kotido	219734
6796	6795	3	Jie County	165846
6797	6796	4	Kacheri	14251
6798	6797	5	Jie Lolelia	4342
6799	6797	5	Kacheri	4111
6800	6797	5	Lokwasinyon	2605
6801	6797	5	Napeikar	3193
6802	6796	4	Kacheri Town Council	20959
6803	6802	5	Kalogwel Ward	5061
6804	6802	5	Kokuwuam Ward	5652
6805	6802	5	Lokiding Ward	4892
6806	6802	5	Lokoona Ward	5354
6807	6796	4	Kamor	10317
6808	6807	5	Kangorok	2378
6809	6807	5	Kapuyon	3180
6810	6807	5	Naadoi	4759
6811	6796	4	Kanair	6749
6812	6811	5	405 Brigade	261
6813	6811	5	Kadocha	1770
6814	6811	5	Kalongolemuge	1381
6815	6811	5	Potongor	3337
6816	6796	4	Kapeta	16898
6817	6816	5	Kokoria	1464
6818	6816	5	Kopor	3438
6819	6816	5	Lobanya	4766
6820	6816	5	Losakucha	3082
6821	6816	5	Lotanyat	4148
6822	6796	4	Kotido	5958
6823	6822	5	Lologoka	2802
6824	6822	5	Nagirigirioi	2337
6825	6822	5	Nangelekek	819
6826	6796	4	Lokitelaebu Town Council	7694
6827	6826	5	Lokitalaebu East Ward	2479
6828	6826	5	Lokitalaebu South Ward	2064
6829	6826	5	Lokitalaebu Ward	3151
6830	6796	4	Lokwakial	6645
6831	6830	5	Kopusang	1156
6832	6830	5	Lookorok	3543
6833	6830	5	Yeele	1946
6834	6796	4	Loletio	5955
6835	6834	5	Lodoket	1492
6836	6834	5	Lomonia	1121
6837	6834	5	Modokonyang	1887
6838	6834	5	Naputir	1455
6839	6796	4	Longaroe	11401
6840	6839	5	Logoman	1979
6841	6839	5	Lopuyo	3592
6842	6839	5	Nakwaalet	1944
6843	6839	5	Naponga	3886
6844	6796	4	Maaru	12592
6845	6844	5	Kanalobae	4510
6846	6844	5	Loongor	952
6847	6844	5	Nakoreto	2737
6848	6844	5	Nakwakwa	2644
6849	6844	5	Rutom	1749
6850	6796	4	Nakapelimoru	13502
6851	6850	5	Kaileny	559
6852	6850	5	Longerep	3662
6853	6850	5	Nakapelimoru Town Board	2466
6854	6850	5	Thiwakol	2790
6855	6850	5	Watakau Central	4025
6856	6796	4	Napumpum	10240
6857	6856	5	Itakwara	2319
6858	6856	5	Lolito	2253
6859	6856	5	Napupum Town Board	5668
6860	6796	4	Panyangara	9073
6861	6860	5	Lodera	2090
6862	6860	5	Rikitae East	3887
6863	6860	5	Rikitae West	3096
6864	6796	4	Rengen	13612
6865	6864	5	Kodokei	2022
6866	6864	5	Kotyang	3488
6867	6864	5	Lokorein	2125
6868	6864	5	Moruitit	2472
6869	6864	5	Rengen Town Board	3505
6870	6795	3	Kotido Municipality	53888
6871	6870	4	Central Division	19295
6872	6871	5	Kotido Central Ward	1967
6873	6871	5	Kotido East Ward	2652
6874	6871	5	Kotido North Ward	1799
6875	6871	5	Kotido Rural Ward	7837
6876	6871	5	Kotido West Ward	2157
6877	6871	5	Narikapet Ward	2883
6878	6870	4	North Division	13773
6879	6878	5	Kapisinyang Ward	627
6880	6878	5	Kotyang Central Ward	3558
6881	6878	5	Lochoto Ward	2529
6882	6878	5	Logwangaita Ward	1459
6883	6878	5	Miresiae Ward	3823
6884	6878	5	Nayese Ward	1777
6885	6870	4	South Division	6401
6886	6885	5	Kadokini Ward	2674
6887	6885	5	Kapadakook Central Ward	1749
6888	6885	5	Nakaal Ward	1978
6889	6870	4	West Division	14419
6890	6889	5	Lokore Ward	3840
6891	6889	5	Nangayom Ward	3169
6892	6889	5	Rom Rom Ward	3945
6893	6889	5	Um-Um Ward	3465
6894	2	2	Kumi	286992
6895	6894	3	Kanyum County	112456
6896	6895	4	Kadami	16374
6897	6896	5	Agaria	1012
6898	6896	5	Akadot	2864
6899	6896	5	Alukat	929
6900	6896	5	Aojamorok	1600
6901	6896	5	Goria	1419
6902	6896	5	Kabukol	1386
6903	6896	5	Kachaboi	1313
6904	6896	5	Kadami	1590
6905	6896	5	Kaderin	1109
6906	6896	5	Komolo	1111
6907	6896	5	Nyaguo	758
6908	6896	5	Odotoi	1283
6909	6895	4	Kakures	13644
6910	6909	5	Aacha	769
6911	6909	5	Aaramor	583
6912	6909	5	Adodoi	900
6913	6909	5	Kakures	477
6914	6909	5	Kalemen	570
6915	6909	5	Kamuno	668
6916	6909	5	Kanyamutamu	660
6917	6909	5	Kituba	875
6918	6909	5	Kodokoto	680
6919	6909	5	Madang	1109
6920	6909	5	Oderekai	583
6921	6909	5	Odokoto	692
6922	6909	5	Okaruka	428
6923	6909	5	Okonai	751
6924	6909	5	Okukunyai	551
6925	6909	5	Oluwa	1674
6926	6909	5	Onyakelo	748
6927	6909	5	Ouriesik	926
6928	6895	4	Kamaca	15467
6929	6928	5	Alemen	2032
6930	6928	5	Kamaca	2855
6931	6928	5	Kamunyumbi	2598
6932	6928	5	Katilekori	2324
6933	6928	5	Ojie	2288
6934	6928	5	Okemer	698
6935	6928	5	Olumot	1553
6936	6928	5	Otiisa	1119
6937	6895	4	Kanyum	24381
6938	6937	5	Ajuket	5318
6939	6937	5	Akisim	1506
6940	6937	5	Ariet	2535
6941	6937	5	Asalo	1630
6942	6937	5	Kabwele	1557
6943	6937	5	Kajamaka	4337
6944	6937	5	Odotuno	1624
6945	6937	5	Olimai	1643
6946	6937	5	Omurang	4231
6947	6895	4	Kanyum Town Council	13604
6948	6947	5	Kabwongo Ward	1412
6949	6947	5	Kacha Ward	1157
6950	6947	5	Kanyum Ward	2279
6951	6947	5	Kogil Ward	1973
6952	6947	5	Obokora Ward	189
6953	6947	5	Okeito Ward	2525
6954	6947	5	Ongario Ward	1964
6955	6947	5	Oput Ward	2105
6956	6895	4	Mukongoro	14164
6957	6956	5	Achunat	1392
6958	6956	5	Kabura	1677
6959	6956	5	Kapuwai	1434
6960	6956	5	Ogosoi	1274
6961	6956	5	Oidon	776
6962	6956	5	Ojinga	1168
6963	6956	5	Okudu	1274
6964	6956	5	Okudumo	1101
6965	6956	5	Oladot	1195
6966	6956	5	Oleico	1637
6967	6956	5	Osopotoit	1236
6968	6895	4	Mukongoro Town Council	14822
6969	6968	5	Acapa Ward	1350
6970	6968	5	Apaade Ward	793
6971	6968	5	Kajamaka Ward	1124
6972	6968	5	Kakorokoron Ward	1083
6973	6968	5	Moru Ward	665
6974	6968	5	Mukongoro Ward	1962
6975	6968	5	Odeidei Ward	1033
6976	6968	5	Ojimoka Ward	1020
6977	6968	5	Olasai Ward	1055
6978	6968	5	Omerein Ward	1402
6979	6968	5	Omodoi Ward	1231
6980	6968	5	Omusikan Ward	978
6981	6968	5	Omusio Ward	1126
6982	6894	3	Kumi County	134755
6983	6982	4	Atutur	23685
6984	6983	5	Akalabai	4563
6985	6983	5	Akibui	2799
6986	6983	5	Apapai	2751
6987	6983	5	Ariet	3690
6988	6983	5	Atutur	4997
6989	6983	5	Kapokin	4885
6990	6982	4	Kanapa	14845
6991	6990	5	Kacherede	1094
6992	6990	5	Kanapa	3626
6993	6990	5	Kangole	1301
6994	6990	5	Kochopo	1315
6995	6990	5	Kodukulu	1269
6996	6990	5	Kongura	969
6997	6990	5	Obotia	1985
6998	6990	5	Totolim	3286
6999	6982	4	Kumi	16968
7000	6999	5	Agolitom	2122
7001	6999	5	Agule	2836
7002	6999	5	Asinge	3403
7003	6999	5	Kumi	1752
7004	6999	5	Olupe	3047
7005	6999	5	Omatenga	2443
7006	6999	5	Oogoria	1365
7007	6982	4	Nyero	20333
7008	7007	5	Agurut	2194
7009	7007	5	Ariet	2723
7010	7007	5	Kalapata	5808
7011	7007	5	Moruikara	2282
7012	7007	5	Moruita	1757
7013	7007	5	Olilim	1826
7014	7007	5	Omatakiria	3743
7015	6982	4	Nyero Town Council	9679
7016	7015	5	Kees Ward	2343
7017	7015	5	Kodike Ward	1936
7018	7015	5	Nyero Ward	2877
7019	7015	5	Obosoi Ward	2523
7020	6982	4	Ogooma	12141
7021	7020	5	Aligoi	1563
7022	7020	5	Atekwa	1978
7023	7020	5	Kamenya	1294
7024	7020	5	Komolo	1504
7025	7020	5	Odipai	1514
7026	7020	5	Ogooma	1841
7027	7020	5	Okanyapurio	1315
7028	7020	5	Ominai	1132
7029	6982	4	Ongino	23801
7030	7029	5	Aakum	3143
7031	7029	5	Akolitorom	1324
7032	7029	5	Ceele	3669
7033	7029	5	Kabwangasi	1567
7034	7029	5	Kachaboi	2830
7035	7029	5	Kachelakweny	1310
7036	7029	5	Kapolin	1888
7037	7029	5	Kareu	1465
7038	7029	5	Morupeded	2120
7039	7029	5	Oseera	4485
7040	6982	4	Ongino Town Council	7844
7041	7040	5	Akuoro Ward	1814
7042	7040	5	Amuria Ward	1307
7043	7040	5	Kapasak Ward	2353
7044	7040	5	Okota Ward	510
7045	7040	5	Ongino Ward	1860
7046	6982	4	Tisai	5459
7047	7046	5	Acera	762
7048	7046	5	Aderun	397
7049	7046	5	Aguya	1267
7050	7046	5	Akide	1664
7051	7046	5	Asinge	395
7052	7046	5	Tisai Island	974
7053	6894	3	Kumi Municipality	39781
7054	7053	4	North Division	16830
7055	7054	5	Amejei Ward	2940
7056	7054	5	Bazaar Ward	4365
7057	7054	5	Kabata Ward	2728
7058	7054	5	Okouba Ward	3819
7059	7054	5	Omolokonyo	2978
7060	7053	4	South Division	22951
7061	7060	5	Abubur Ward	3833
7062	7060	5	Aputon Ward	1963
7063	7060	5	Aterai Ward	3158
7064	7060	5	Boma Ward	1310
7065	7060	5	Kanyum Ward	3534
7066	7060	5	Kelim Ward	2608
7067	7060	5	Olungia Ward	2282
7068	7060	5	Otipe Ward	2360
7069	7060	5	Tank Ward	1903
7070	3	2	Kwania	216125
7071	7070	3	Kwania County	100990
7072	7071	4	Atongtidi	21828
7073	7072	5	Acenlworo	4153
7074	7072	5	Agolowelo	3473
7075	7072	5	Atongtidi	2895
7076	7072	5	Goi	3918
7077	7072	5	Iwal	3958
7078	7072	5	Wigweng	3431
7079	7071	4	Ayabi	19159
7080	7079	5	Abuli	3676
7081	7079	5	Aculawic	2525
7082	7079	5	Bung	6529
7083	7079	5	Ogwil	3064
7084	7079	5	Owiny	3365
7085	7071	4	Ayabi Town Council	10997
7086	7085	5	Ayabi Ward	3435
7087	7085	5	Central Ward	4448
7088	7085	5	Punuatar Ward	3114
7089	7071	4	Cawente	23002
7090	7089	5	Abapiri	5305
7091	7089	5	Adograo	3434
7092	7089	5	Ajar	3620
7093	7089	5	Alido	4430
7094	7089	5	Apolika	3528
7095	7089	5	Atule	2685
7096	7071	4	Nambieso	26004
7097	7096	5	Acaba	3958
7098	7096	5	Acwao	2980
7099	7096	5	Anwangi	4219
7100	7096	5	Aornga	5520
7101	7096	5	Etekiber	6048
7102	7096	5	Ojokdot	3279
7103	7070	3	Kwania North County	115135
7104	7103	4	Abongomola	21566
7105	7104	5	Abany	4752
7106	7104	5	Acungi	6288
7107	7104	5	Amorigoga	3273
7108	7104	5	Ogwok	3942
7109	7104	5	Teioro	3311
7110	7103	4	Aduku	29998
7111	7110	5	Aboko	9287
7112	7110	5	Adyeda	3112
7113	7110	5	Alira	6701
7114	7110	5	Apire	6651
7115	7110	5	Ongoceng	4247
7116	7103	4	Aduku Town Council	10545
7117	7116	5	Ikwera Ward	4278
7118	7116	5	Teduka Ward	6267
7119	7103	4	Akali	17461
7120	7119	5	Abwong	4279
7121	7119	5	Aderolongo	3600
7122	7119	5	Agwa	4386
7123	7119	5	Akali	3069
7124	7119	5	Alel	2127
7125	7103	4	Inomo	24623
7126	7125	5	Agwiciri	6455
7127	7125	5	Ajok	8060
7128	7125	5	Aluka	5936
7129	7125	5	Banya	4172
7130	7103	4	Inomo Town Council	10942
7131	7130	5	Eastern Ward	5263
7132	7130	5	Western Ward	5679
7133	2	2	Kween	129277
7134	7133	3	Kween County	102402
7135	7134	4	Benet	6882
7136	7135	5	Kitany	820
7137	7135	5	Likil	1375
7138	7135	5	Mengya	1737
7139	7135	5	Piswa	1734
7140	7135	5	Taragon	1216
7141	7134	4	Binyiny	5946
7142	7141	5	Chepyakaniet	592
7143	7141	5	Kisongi	950
7144	7141	5	Kono	1072
7145	7141	5	Tabagon	1835
7146	7141	5	Tukumo	1497
7147	7134	4	Binyiny Town Council	5212
7148	7147	5	Kapkworos Ward	1597
7149	7147	5	Kisongi Ward	2250
7150	7147	5	Kwobus Ward	1365
7151	7134	4	Kapkwata	5723
7152	7151	5	Cherakan	727
7153	7151	5	Kaperotwo	252
7154	7151	5	Kapkwata	1012
7155	7151	5	Kapkworos	631
7156	7151	5	Kusurut	579
7157	7151	5	Kworus	1378
7158	7151	5	Sismach	1144
7159	7134	4	Kapnarkut Town Council	2490
7160	7159	5	Chemanga Ward	435
7161	7159	5	Kamasaren Ward	460
7162	7159	5	Kapkuneroi Ward	307
7163	7159	5	Kapnarkut Ward	537
7164	7159	5	Kapsoboiwyo Ward	206
7165	7159	5	Ngenge Ward	545
7166	7134	4	Kaproron	2583
7167	7166	5	Chemwania	535
7168	7166	5	Kamwam	836
7169	7166	5	Rarawa	1212
7170	7134	4	Kaproron Town Council	6536
7171	7170	5	Chemwina East Ward	771
7172	7170	5	Kaplakatet Ward	881
7173	7170	5	Kaproron Ward	1349
7174	7170	5	Kapsomo Ward	1102
7175	7170	5	Kere Ward	438
7176	7170	5	Korosi Ward	796
7177	7170	5	Sundet Ward	1199
7178	7134	4	Kaptoyoy	10646
7179	7178	5	Kapkoch	2353
7180	7178	5	Kapteng	1097
7181	7178	5	Kaptoyoy	1348
7182	7178	5	Kerop	2095
7183	7178	5	Ngoryemwo	1226
7184	7178	5	Toswo	2527
7185	7134	4	Kaptum	7794
7186	7185	5	Aloman	2288
7187	7185	5	Chebinyiny	1059
7188	7185	5	Cheminy	1167
7189	7185	5	Kaptum	1725
7190	7185	5	Serere	1555
7191	7134	4	Kaseko	6868
7192	7191	5	Cheberen	2241
7193	7191	5	Kaseko	1459
7194	7191	5	Mulungwa	1935
7195	7191	5	Tambajja	1233
7196	7134	4	Kitawoi	10184
7197	7196	5	Kewakween	1273
7198	7196	5	Kitawoi	1511
7199	7196	5	Sumaton	862
7200	7196	5	Tabagon	2478
7201	7196	5	Tarak	1612
7202	7196	5	Terenpoy	2448
7203	7134	4	Kwanyiy	6063
7204	7203	5	Kamwesa	1080
7205	7203	5	Kapkwaikoi	820
7206	7203	5	Kaplegep	557
7207	7203	5	Kutwech	834
7208	7203	5	Munda	704
7209	7203	5	Nyimei	1018
7210	7203	5	Sumotwo	1050
7211	7134	4	Kwosir	8559
7212	7211	5	Chepkube	1080
7213	7211	5	Cheptandan	1369
7214	7211	5	Cherangut	1638
7215	7211	5	Kapngotiny	1153
7216	7211	5	Kaworyo	1240
7217	7211	5	Kwosir	1427
7218	7211	5	Topot	652
7219	7134	4	Moyok	7173
7220	7219	5	Kabelyo	2463
7221	7219	5	Kapchesimet	1009
7222	7219	5	Kaplekepsoi	595
7223	7219	5	Kapyatei	1599
7224	7219	5	Moyok	1507
7225	7134	4	Tuikat	9743
7226	7225	5	Chepkutus	1906
7227	7225	5	Kere	1952
7228	7225	5	Moigut	759
7229	7225	5	Sosur	933
7230	7225	5	Tolil	396
7231	7225	5	Tuikat	787
7232	7225	5	Yatui	3010
7233	7133	3	Soi County	26875
7234	7233	4	Chepsukunya Town Council	6516
7235	7234	5	Cheptere Ward	2014
7236	7234	5	Kapkwich Ward	1299
7237	7234	5	Nasak Ward	1270
7238	7234	5	Ngariamwet Ward	1449
7239	7234	5	Tulwo Ward	484
7240	7233	4	Greek River (kiriki)	5755
7241	7240	5	Alalam	31
7242	7240	5	Kapswama	393
7243	7240	5	Kere	311
7244	7240	5	Kiriki	3423
7245	7240	5	Korite	1597
7246	7233	4	Ngenge	10303
7247	7246	5	Kabachiria	2373
7248	7246	5	Kapkwot	4707
7249	7246	5	Sikwo	2004
7250	7246	5	Sosho	1219
7251	7233	4	Sundet	4301
7252	7251	5	Kapterit	709
7253	7251	5	Kubobey	1775
7254	7251	5	Nyilit	1053
7255	7251	5	Sundet	764
7256	1	2	Kyankwanzi	278432
7257	7256	3	Butemba County	160524
7258	7257	4	Bananywa	18790
7259	7258	5	Bananywa	3932
7260	7258	5	Kirimbi	3654
7261	7258	5	Kiryannongo	3440
7262	7258	5	Kisoodo	2977
7263	7258	5	Lwengo	4787
7264	7257	4	Banda	4401
7265	7264	5	Banda	1211
7266	7264	5	Bwaaba	900
7267	7264	5	Kamutiika	948
7268	7264	5	Lwemiganda	1342
7269	7257	4	Butemba	24462
7270	7269	5	Bulamula	1689
7271	7269	5	Kasiribya	1996
7272	7269	5	Kikoma	1341
7273	7269	5	Kyenda	4127
7274	7269	5	Lwabalanga	1831
7275	7269	5	Lwamagaali	3246
7276	7269	5	Lwendagi	2510
7277	7269	5	Misago	4283
7278	7269	5	Nabitakuli	3439
7279	7257	4	Butemba Town Council	25338
7280	7279	5	Bukwiri Ward	8460
7281	7279	5	Butemba Ward	2490
7282	7279	5	Kamirambazzi Ward	3366
7283	7279	5	Katanabirwa Ward	3466
7284	7279	5	Lwebisiriza Ward	3134
7285	7279	5	Lwenkonge Ward	2250
7286	7279	5	Rwengiri Ward	2172
7287	7257	4	Byerima	18283
7288	7287	5	Buguluma	3083
7289	7287	5	Byerima	4620
7290	7287	5	Kamukanga	2430
7291	7287	5	Katovu	1047
7292	7287	5	Kijuubya	2188
7293	7287	5	Kiryamusunku	3234
7294	7287	5	Kiteredde	1681
7295	7257	4	Kigando	14111
7296	7295	5	Kakindu	1045
7297	7295	5	Kamucope	2388
7298	7295	5	Kigabwa	2914
7299	7295	5	Kigando	4611
7300	7295	5	Mbogobbiri	3153
7301	7257	4	Kyankwanzi	7913
7302	7301	5	Kasejere	1817
7303	7301	5	Lubiri	2353
7304	7301	5	Mpango	2550
7305	7301	5	Nyabweyo	1193
7306	7257	4	Kyankwanzi Town Council	10166
7307	7306	5	Biroboka Ward	999
7308	7306	5	Gala Ward	983
7309	7306	5	Kibabi Ward	1663
7310	7306	5	Kyankwanzi Ward	2784
7311	7306	5	Lwebisanja Ward	833
7312	7306	5	Nteyera Ward	1518
7313	7306	5	Rwengaju Ward	1386
7314	7257	4	Nsambya	19119
7315	7314	5	Kalagi	2584
7316	7314	5	Katuugo	4739
7317	7314	5	Kikonda	4754
7318	7314	5	Kiyigikwa	2130
7319	7314	5	Kyakabuga	1790
7320	7314	5	Kyamusakazi	918
7321	7314	5	Mbaali	2204
7322	7257	4	Ntunda Town Council	17941
7323	7322	5	Bakusekamajja Ward	3195
7324	7322	5	Bukomero Ward	501
7325	7322	5	Kazo Ward	1467
7326	7322	5	Kigangazzi Ward	880
7327	7322	5	Kiteesa Ward	2271
7328	7322	5	Mujunza Ward	1289
7329	7322	5	Ndaweringa Ward	892
7330	7322	5	Ntunda Ward	5469
7331	7322	5	Wandegeya Ward	1977
7332	7256	3	Ntwetwe County	117908
7333	7332	4	Gayaza	16709
7334	7333	5	Gayaza	2976
7335	7333	5	Kasanje	2545
7336	7333	5	Kiryajobyo	2757
7337	7333	5	Kiyuni	5164
7338	7333	5	Nkondo	3267
7339	7332	4	Kiryannongo	5982
7340	7339	5	Bulagwe	1199
7341	7339	5	Kiryannongo	1510
7342	7339	5	Kisomesa	966
7343	7339	5	Natyole	1537
7344	7339	5	Ncucwe	770
7345	7332	4	Kisala	9284
7346	7345	5	Kasekka	1629
7347	7345	5	Kikuubya	2499
7348	7345	5	Kisala	2039
7349	7345	5	Luwuuna	1900
7350	7345	5	Nakivubo	1217
7351	7332	4	Masodde-Kalagi Town Council	7897
7352	7351	5	Kalagi Ward	2840
7353	7351	5	Kigoma Ward	1424
7354	7351	5	Masodde Ward	2417
7355	7351	5	Vvumba Ward	1216
7356	7332	4	Mulagi	12168
7357	7356	5	Bumbiri	2643
7358	7356	5	Kigando	2878
7359	7356	5	Kiteredde	1578
7360	7356	5	Kiwaguzi	2737
7361	7356	5	Luwawu	2332
7362	7332	4	Muwangi	8525
7363	7362	5	Bambala	1671
7364	7362	5	Ddegeya	2759
7365	7362	5	Kitwala	1973
7366	7362	5	Muwangi	2122
7367	7332	4	Nkandwa	8728
7368	7367	5	Bugomolwa	1509
7369	7367	5	Kabuwuka	1397
7370	7367	5	Kasoolo	1483
7371	7367	5	Nakalama	1901
7372	7367	5	Nkandwa	1035
7373	7367	5	Ntiba	1403
7374	7332	4	Ntwetwe	9856
7375	7374	5	Kabuye	2100
7376	7374	5	Kayindiyindi	1885
7377	7374	5	Kitabona	2852
7378	7374	5	Sirimula	3019
7379	7332	4	Ntwetwe Town Council	15439
7380	7379	5	Kigoma Ward	1440
7381	7379	5	Kisojo Ward	1784
7382	7379	5	Lwanjale Ward	834
7383	7379	5	Ndibata Ward	2092
7384	7379	5	Ntuuti Ward	1815
7385	7379	5	Ntwetwe Central Ward	2700
7386	7379	5	Ntwetwe Upper Ward	4774
7387	7332	4	Wattuba	13830
7388	7387	5	Kiduumi	1402
7389	7387	5	Kikolimbo	1555
7390	7387	5	Kisolooza	3718
7391	7387	5	Kisozi	1457
7392	7387	5	Lwansama	2286
7393	7387	5	Nabulembeko	3412
7394	7332	4	Wattuba Town Council	9490
7395	7394	5	Kalukwajju Ward	1845
7396	7394	5	Kiyombya Ward	2636
7397	7394	5	Nakitembe Ward	1867
7398	7394	5	Wattuba Ward	3142
7399	4	2	Kyegegwa	501120
7400	7399	3	Kyaka Central County	221072
7401	7400	4	Kakabara Town Council	19467
7402	7401	5	Buraro Ward	4840
7403	7401	5	Kakabara Ward	4378
7404	7401	5	Kikyedo Ward	5131
7405	7401	5	Kisiita Ward	5118
7406	7400	4	Kyaka II Refugee Camp	90021
7407	7406	5	Bukere	18020
7408	7406	5	Buliti	3401
7409	7406	5	Bwiriza	8516
7410	7406	5	Byabakora	14661
7411	7406	5	Itambabiniga	11207
7412	7406	5	Kaborogota	5197
7413	7406	5	Kakoni	3534
7414	7406	5	Mukondo	10974
7415	7406	5	Sweswe	14511
7416	7400	4	Kyatega	23921
7417	7416	5	Katamba	7755
7418	7416	5	Kyatega	6971
7419	7416	5	Nkomangani	9195
7420	7400	4	Kyegegwa	37653
7421	7420	5	Bulingo	5172
7422	7420	5	Kabweza	9667
7423	7420	5	Kibuye	13133
7424	7420	5	Kihamba	5663
7425	7420	5	Sweswe	4018
7426	7400	4	Kyegegwa Town Council	33476
7427	7426	5	Kibira Ward	7730
7428	7426	5	Kyegegwa Ward	12739
7429	7426	5	Nkaaka Ward	7190
7430	7426	5	Nyamuhanami Ward	5817
7431	7400	4	Nkanja	16534
7432	7431	5	Bujubuli	4085
7433	7431	5	Kakoni	2643
7434	7431	5	Kyabulikuya	4572
7435	7431	5	Kyamagabu	5234
7436	7399	3	Kyaka North County	160443
7437	7436	4	Bugogo Town Council	13545
7438	7437	5	Bugogo Ward	2677
7439	7437	5	Hamuyaga Ward	2157
7440	7437	5	Kabagara Ward	2964
7441	7437	5	Kigarama Ward	1670
7442	7437	5	Mabyarra Ward	2272
7443	7437	5	Ngangi Ward	1805
7444	7436	4	Hapuuyo	13696
7445	7444	5	Iringa	3105
7446	7444	5	Kijuma	4930
7447	7444	5	Mukonda	2988
7448	7444	5	Rucwamiigo	2673
7449	7436	4	Hapuuyo Town Council	20751
7450	7449	5	Karumaima Ward	5539
7451	7449	5	Kitaleesa Ward	4116
7452	7449	5	Muziizi Ward	4904
7453	7449	5	Nyamugura Ward	6192
7454	7436	4	Kakabara	25058
7455	7454	5	Ihunga	5383
7456	7454	5	Kihaguzi	4739
7457	7454	5	Kijaguzo	10070
7458	7454	5	Kyarwehuta	4866
7459	7436	4	Kasule	21233
7460	7459	5	Karama	5409
7461	7459	5	Kasule	3892
7462	7459	5	Kibuuba	11932
7463	7436	4	Kigambo	27796
7464	7463	5	Kigambo	9488
7465	7463	5	Kyanyambali	9472
7466	7463	5	Magoma	8836
7467	7436	4	Migongwe	20430
7468	7467	5	Kigorani	3299
7469	7467	5	Kisoira	5741
7470	7467	5	Kyankunyule	2000
7471	7467	5	Migongwe	9390
7472	7436	4	Nkaakwa	17934
7473	7472	5	Isunga	2980
7474	7472	5	Kaingani	2910
7475	7472	5	Lyaruhinda	7283
7476	7472	5	Nkaakwa	4761
7477	7399	3	Kyaka South County	119605
7478	7477	4	Kazinga Town Council	13038
7479	7478	5	Kazinga Ward	4849
7480	7478	5	Rushayumbe Ward	4631
7481	7478	5	Rutaraka Ward	3558
7482	7477	4	Migamba	14199
7483	7482	5	Kahungura	2376
7484	7482	5	Kasabanwa	1526
7485	7482	5	Kitembe	1482
7486	7482	5	Migamba	2139
7487	7482	5	Nsonga	2794
7488	7482	5	Sooba	3882
7489	7477	4	Mpara	13404
7490	7489	5	Kibaale	3080
7491	7489	5	Kiryabyooma	1481
7492	7489	5	Nyakatoma	4903
7493	7489	5	Rwahunga	3940
7494	7477	4	Mpara Town Council	21660
7495	7494	5	Bugido Ward	2530
7496	7494	5	Kisambya Ward	6621
7497	7494	5	Mpara Ward	4239
7498	7494	5	Musanju Ward	5151
7499	7494	5	Nsondaitano Ward	3119
7500	7477	4	Ruyonza	35361
7501	7500	5	Karwenyi	7773
7502	7500	5	Katiirwe	7280
7503	7500	5	Kijongobya	8664
7504	7500	5	Kiremba	5698
7505	7500	5	Kishagazi	5946
7506	7477	4	Rwentuha	21943
7507	7506	5	Kabaraba	3782
7508	7506	5	Kyarujumba	1961
7509	7506	5	Kyeshombire	3402
7510	7506	5	Ngangi	4605
7511	7506	5	Ruhangire	3970
7512	7506	5	Rwentuha	4223
7513	4	2	Kyenjojo	543998
7514	7513	3	Mwenge Central County	128922
7515	7514	4	Bugaaki	20438
7516	7515	5	Busasa	1601
7517	7515	5	Hiima	3622
7518	7515	5	Kasamba	2614
7519	7515	5	Kasenyi	3234
7520	7515	5	Kyabagonza	2604
7521	7515	5	Kyabaranga	2465
7522	7515	5	Kyanyamukwaya	1569
7523	7515	5	Mitoma	2729
7524	7514	4	Katooke	25465
7525	7524	5	Bwahurro	2809
7526	7524	5	Kijwiga	2875
7527	7524	5	Kinogero	5523
7528	7524	5	Kitonya	3657
7529	7524	5	Kyakaboyo	3183
7530	7524	5	Myeri	3738
7531	7524	5	Rwamukora	3680
7532	7514	4	Katooke Town Council	20303
7533	7532	5	Iborooga Ward	2569
7534	7532	5	Kakuba Ward	3506
7535	7532	5	Katara Ward	4626
7536	7532	5	Katooke Ward	2435
7537	7532	5	Kyanyabongo Ward	3706
7538	7532	5	Mwaro Ward	3461
7539	7514	4	Kyarusozi	15101
7540	7539	5	Barahiija	3477
7541	7539	5	Kaisamba	2187
7542	7539	5	Kyanyinaibale	2696
7543	7539	5	Kyongera	3409
7544	7539	5	Nsinde	3332
7545	7514	4	Kyarusozi Town Council	14565
7546	7545	5	Binunda Ward	2187
7547	7545	5	Buhaza Ward	2029
7548	7545	5	Kihara Ward	2582
7549	7545	5	Kyamugenyi Ward	2031
7550	7545	5	Kyarusozi Ward	1325
7551	7545	5	Nyakitojo Ward	4411
7552	7514	4	Nyakisi	19802
7553	7552	5	Enjeru	2928
7554	7552	5	Kabatooro	2013
7555	7552	5	Kafunda	2820
7556	7552	5	Kagorra	3166
7557	7552	5	Nyakisi	3810
7558	7552	5	Rubango	5065
7559	7514	4	Rugombe Town Council	13248
7560	7559	5	Butara Ward	2397
7561	7559	5	Kisangi Ward	3443
7562	7559	5	Mihondo Ward	1378
7563	7559	5	Nyamabuga Ward	2793
7564	7559	5	Rugombe Ward	3237
7565	7513	3	Mwenge County	415076
7566	7565	4	Batalika	12140
7567	7566	5	Batalika	3559
7568	7566	5	Bigando	1530
7569	7566	5	Kijebere	2165
7570	7566	5	Kisansa	1826
7571	7566	5	Mburara	1175
7572	7566	5	Mubembe	1885
7573	7565	4	Bufunjo	13271
7574	7573	5	Bukongwa	4998
7575	7573	5	Kataraza	3408
7576	7573	5	Kategere	1917
7577	7573	5	Rwenjaza	2948
7578	7565	4	Butiiti	9370
7579	7578	5	Bwenzi	1401
7580	7578	5	Isandara	3662
7581	7578	5	Kaihura	4307
7582	7565	4	Butiiti Town Council	13805
7583	7582	5	Busanza Ward	3383
7584	7582	5	Butiiti Ward	2903
7585	7582	5	Kakindo Ward	3109
7586	7582	5	Mukunyu Ward	4410
7587	7565	4	Butunduzi	16459
7588	7587	5	Kanyinya	4125
7589	7587	5	Mateete	1181
7590	7587	5	Mugali	1896
7591	7587	5	Nakahuka	2480
7592	7587	5	Nyabubale	2042
7593	7587	5	Nyakatoma	2340
7594	7587	5	Rugorra	2395
7595	7565	4	Butunduzi Town Council	22468
7596	7595	5	Butubiri Ward	1896
7597	7595	5	Butunduzi Ward	3796
7598	7595	5	Igaali Ward	3239
7599	7595	5	Kyanyamugabo Ward	1482
7600	7595	5	Mukonomura Ward	1862
7601	7595	5	Rubaka Ward	1942
7602	7595	5	Rwenyunyuzi Ward	1605
7603	7595	5	Rwibale Ward	6646
7604	7565	4	Kanyegaramire	13222
7605	7604	5	Byerwa	1479
7606	7604	5	Kanyegaramire	3344
7607	7604	5	Kyamugarra	4046
7608	7604	5	Nyamicu	4353
7609	7565	4	Kifuka Town Council	16100
7610	7609	5	Kandama Ward	4101
7611	7609	5	Kihuura Ward	1994
7612	7609	5	Mbale Ward	7086
7613	7609	5	Nyamanga Ward	2919
7614	7565	4	Kigaraale	19406
7615	7614	5	Ikamiro	1998
7616	7614	5	Kabaale	4522
7617	7614	5	Kigaraale	3845
7618	7614	5	Kikumiro	2629
7619	7614	5	Kisengya	1419
7620	7614	5	Mabuga	1814
7621	7614	5	Nyaibanda	3179
7622	7565	4	Kigoyera	34336
7623	7622	5	Igoma	3342
7624	7622	5	Katambale	5092
7625	7622	5	Kigoyera	13412
7626	7622	5	Kitugutu	7104
7627	7622	5	Mwokya	5386
7628	7565	4	Kihuura	33209
7629	7628	5	Kawaruju	5962
7630	7628	5	Kihuura	5856
7631	7628	5	Kijweka	8507
7632	7628	5	Kyankaramata	4358
7633	7628	5	Matiri	4770
7634	7628	5	Ngombe	3756
7635	7565	4	Kisojo	13203
7636	7635	5	Kikoda	3715
7637	7635	5	Kitongole	6049
7638	7635	5	Rweitengya	3439
7639	7565	4	Kisojo Town Council	16045
7640	7639	5	Bibuye Ward	3934
7641	7639	5	Kigunda Ward	4891
7642	7639	5	Kisojo Ward	4366
7643	7639	5	Kyamitara Ward	2854
7644	7565	4	Kitega	8658
7645	7644	5	Kijengi	2369
7646	7644	5	Kisengya	1401
7647	7644	5	Kitega	2577
7648	7644	5	Rukukuru	2311
7649	7565	4	Kyakatwire Town Council	12213
7650	7649	5	Kangondo Ward	2276
7651	7649	5	Kyakatwire Ward	4324
7652	7649	5	Mwibaale Ward	5613
7653	7565	4	Kyamutunzi Town Council	7624
7654	7653	5	Kakindo Ward	1896
7655	7653	5	Katoogo Ward	1918
7656	7653	5	Kihani Ward	1921
7657	7653	5	Muzizi Ward	1889
7658	7565	4	Kyembogo	25160
7659	7658	5	Kasaba	7230
7660	7658	5	Kyamugenyi	3955
7661	7658	5	Mirambi	3534
7662	7658	5	Mparo	7165
7663	7658	5	Nyaburara	3276
7664	7565	4	Kyenjojo Town Council	35014
7665	7664	5	Bucuni Ward	3469
7666	7664	5	Hakatoma Ward	3728
7667	7664	5	Kasiina Ward	4994
7668	7664	5	Kijuma Ward	8301
7669	7664	5	Kirongo Ward	5877
7670	7664	5	Misandika Ward	3579
7671	7664	5	Ntooma Ward	5066
7672	7565	4	Mabira Town Council	14955
7673	7672	5	Haikona Ward	3291
7674	7672	5	Kitaihuka Ward	3248
7675	7672	5	Kyasigireki Ward	4772
7676	7672	5	Mabira Ward	3644
7677	7565	4	Mbale Town Council	15394
7678	7677	5	Buhyabunga Ward	1213
7679	7677	5	Bulezi Ward	771
7680	7677	5	Kaigoro Ward	2282
7681	7677	5	Kamugasa Ward	1799
7682	7677	5	Katebe Ward	2302
7683	7677	5	Kinubi Ward	1514
7684	7677	5	Mihikiro Ward	1630
7685	7677	5	Mugoma Ward	3883
7686	7565	4	Nyabirongo	10664
7687	7686	5	Kaswa	2355
7688	7686	5	Kisangi	3471
7689	7686	5	Kyakasana	1562
7690	7686	5	Nsanja	1837
7691	7686	5	Nyabirongo	1439
7692	7565	4	Nyabuharwa	14290
7693	7692	5	Kabirizi	3307
7694	7692	5	Kigando	3548
7695	7692	5	Kinyantale	2903
7696	7692	5	Nyabuharwa	2560
7697	7692	5	Nyakarongo	1972
7698	7565	4	Nyankwanzi	8643
7699	7698	5	Kaitanyana	1452
7700	7698	5	Kamazima	1266
7701	7698	5	Kibale	1478
7702	7698	5	Nturagye	2534
7703	7698	5	Nyamyezi	1913
7704	7565	4	Nyantungo	29427
7705	7704	5	Buraro	6012
7706	7704	5	Ihamba	2036
7707	7704	5	Kanyandahi	2228
7708	7704	5	Kibira	4408
7709	7704	5	Kyamutasa	4087
7710	7704	5	Mabaale	2368
7711	7704	5	Mabwonwa	2900
7712	7704	5	Ntuntu	2708
7713	7704	5	Ruhoko	2680
7714	1	2	Kyotera	275917
7715	7714	3	Kakuuto County	86837
7716	7715	4	Kakuuto	29181
7717	7716	5	Bigada	5128
7718	7716	5	Kakuuto	8999
7719	7716	5	Katovu	6548
7720	7716	5	Mayanja	5372
7721	7716	5	Sango Bay	3134
7722	7715	4	Kasasa	22227
7723	7722	5	Kijonjo	3583
7724	7722	5	Kimukunda	3439
7725	7722	5	Kisuula	1933
7726	7722	5	Mityebiri	3520
7727	7722	5	Ssanje-Kabano	9752
7728	7715	4	Kasensero Town Council	4053
7729	7728	5	Central A Ward	749
7730	7728	5	Central B Ward	696
7731	7728	5	Kagera A Ward	1067
7732	7728	5	Kagera B Ward	474
7733	7728	5	Kimwanyi Ward	1067
7734	7715	4	Kyebe	14422
7735	7734	5	Gwanda	4856
7736	7734	5	Kanabulemu	4412
7737	7734	5	Kibumba	2469
7738	7734	5	Minziro	2685
7739	7715	4	Mutukula Town Council	13726
7740	7739	5	Biwa Ward	1915
7741	7739	5	Central Ward	2055
7742	7739	5	Kasanvu Ward	1359
7743	7739	5	Kozza Ward	4606
7744	7739	5	Lwazi Ward	3791
7745	7715	4	Nangoma	3228
7746	7745	5	Bukwale	370
7747	7745	5	Lukunyu	549
7748	7745	5	Mizinda	1181
7749	7745	5	Nangoma	1128
7750	7714	3	Kyotera County	189080
7751	7750	4	Kabira	35659
7752	7751	5	Bisanje	5744
7753	7751	5	Bwamijja	7706
7754	7751	5	Kyanika	7565
7755	7751	5	Ndolo	9274
7756	7751	5	Njala	5370
7757	7750	4	Kalisizo	21764
7758	7757	5	Kakoma	4428
7759	7757	5	Kikungwe	6267
7760	7757	5	Kyango	4843
7761	7757	5	Matale	2696
7762	7757	5	Miti	3530
7763	7750	4	Kalisizo Town Council	14488
7764	7763	5	Bulinda Ward	2315
7765	7763	5	Kalagala Ward	2602
7766	7763	5	Kalisizo Ward	6336
7767	7763	5	Ninzi Ward	3235
7768	7750	4	Kasaali Town Council	36659
7769	7768	5	Buziranduulu Ward	3000
7770	7768	5	Gayaza Ward	6144
7771	7768	5	Kigenya Ward	7341
7772	7768	5	Kyakonda Ward	13153
7773	7768	5	Nkenge Ward	7021
7774	7750	4	Kirumba	27785
7775	7774	5	Buyiisa	7195
7776	7774	5	Byerima	4034
7777	7774	5	Kabuwoko	3219
7778	7774	5	Kizibira	4460
7779	7774	5	Kyengeza	5888
7780	7774	5	Lwamba	2989
7781	7750	4	Kyotera Town Council	13860
7782	7781	5	Central Ward	1211
7783	7781	5	Industrial Area	1805
7784	7781	5	Mitukula Ward	10844
7785	7750	4	Lwankoni	16640
7786	7785	5	Kayanja	1584
7787	7785	5	Kibutamo	4791
7788	7785	5	Kisunku	1749
7789	7785	5	Lwankoni	3365
7790	7785	5	Nabyajjwe	5151
7791	7750	4	Nabigasa	22225
7792	7791	5	Bethelehem	6045
7793	7791	5	Kijejja	2018
7794	7791	5	Kyassimbi	3442
7795	7791	5	Nabigasa	5530
7796	7791	5	Nakatoogo	5190
7797	3	2	Lamwo	213156
7798	7797	3	Lamwo County	120161
7799	7798	4	Aceba	9425
7800	7799	5	Abakadyak	2508
7801	7799	5	Lapyem	1747
7802	7799	5	Lokili	2974
7803	7799	5	Ywaya	2196
7804	7798	4	Agoro	14029
7805	7804	5	Laruc	2714
7806	7804	5	Lopulingi	2013
7807	7804	5	Lorunya	1298
7808	7804	5	Ngacino	1580
7809	7804	5	Pobar	3400
7810	7804	5	Rudi	3024
7811	7798	4	Katum	4016
7812	7811	5	Agulugwette	1495
7813	7811	5	Katum	1752
7814	7811	5	Lalak	769
7815	7798	4	Lamwo Town Council	10127
7816	7815	5	Ateng Par Ward	1050
7817	7815	5	Atiba Ward	639
7818	7815	5	Ocula Ward	860
7819	7815	5	Ogwech Ward	1339
7820	7815	5	Olebi Ward	2310
7821	7815	5	Pakalabule Ward	1058
7822	7815	5	Pobel Ward	2871
7823	7798	4	Lokung	14645
7824	7823	5	Licwa	2360
7825	7823	5	Ngomoromo	3806
7826	7823	5	Opee	2198
7827	7823	5	Pangira	2657
7828	7823	5	Pawor	1558
7829	7823	5	Pawor West	2066
7830	7798	4	Lokung East	8948
7831	7830	5	Dibolyec	1495
7832	7830	5	Gotkwar	1797
7833	7830	5	Lalak	1001
7834	7830	5	Lela Pwot	1800
7835	7830	5	Limur	1758
7836	7830	5	Parapono	1097
7837	7798	4	Madi-Opei	7559
7838	7837	5	Lawiye-Oduny	1301
7839	7837	5	Okol	4221
7840	7837	5	Pobura	2037
7841	7798	4	Madi-Opei Town Council	5510
7842	7841	5	Kal Ward	1826
7843	7841	5	Loker Ward	1125
7844	7841	5	Pobang Ward	2559
7845	7798	4	Padibe East	7307
7846	7845	5	Alaa	1585
7847	7845	5	Lawok	1440
7848	7845	5	Panyinga	1929
7849	7845	5	Wangtit	2353
7850	7798	4	Padibe Town Council	11132
7851	7850	5	Atwol Ward	2732
7852	7850	5	Gangdyang Ward	2149
7853	7850	5	Kamama Ward	2223
7854	7850	5	Kuluyee Ward	1247
7855	7850	5	Mura Ward	2781
7856	7798	4	Padibe West	6322
7857	7856	5	Lagwel	1545
7858	7856	5	Madi Agweng	2203
7859	7856	5	Madi-Kiloch	2574
7860	7798	4	Paloga	13033
7861	7860	5	Bungu	4350
7862	7860	5	Paloga	5519
7863	7860	5	Pawaja	3164
7864	7798	4	Potika	8108
7865	7864	5	Ajukuku	1966
7866	7864	5	Aringa	1857
7867	7864	5	Pawach	2218
7868	7864	5	Potika	2067
7869	7797	3	Palabek County	92995
7870	7869	4	Ogili	9613
7871	7870	5	Akworo	658
7872	7870	5	Apyeta	5502
7873	7870	5	Lugwar	771
7874	7870	5	Ogili	2682
7875	7869	4	Palabek Abera	5549
7876	7875	5	Abera	1385
7877	7875	5	Cubu	2619
7878	7875	5	Pawena	1545
7879	7869	4	Palabek Kal Town Council	7811
7880	7879	5	Bwomono Ward	1842
7881	7879	5	Kal Ward	4179
7882	7879	5	Labigiryang Ward	925
7883	7879	5	Lanywang Ward	410
7884	7879	5	Pauma Ward	455
7885	7869	4	Palabek Nyimur	8542
7886	7885	5	Aywee	686
7887	7885	5	Burpong	1114
7888	7885	5	Kadomera	1546
7889	7885	5	Padwat	1827
7890	7885	5	Paracelle	939
7891	7885	5	Pece	563
7892	7885	5	Warigo	1867
7893	7869	4	Palabek Refugee Settlement Camp	36548
7894	7893	5	Zone 1	3508
7895	7893	5	Zone 2	3123
7896	7893	5	Zone 3	3001
7897	7893	5	Zone 4	5947
7898	7893	5	Zone 5a	3886
7899	7893	5	Zone 5b	4804
7900	7893	5	Zone 6	4463
7901	7893	5	Zone 7	4496
7902	7893	5	Zone 8	1926
7903	7893	5	Zone 9	1394
7904	7869	4	Palabek-Gem	14971
7905	7904	5	Anaka	4213
7906	7904	5	Gem	2728
7907	7904	5	Lagura	2065
7908	7904	5	Moroto	3160
7909	7904	5	Patanga	1659
7910	7904	5	Patanga East	1146
7911	7869	4	Palabek-Kal	9961
7912	7911	5	Ayuu Alali	2769
7913	7911	5	Kal	1274
7914	7911	5	Labigiryang	1885
7915	7911	5	Lamwo	4033
7916	3	2	Lira	242216
7917	7916	3	Erute County	242216
7918	7917	4	Agali	29331
7919	7918	5	Abongorwot	2795
7920	7918	5	Adyaka	4902
7921	7918	5	Alyet	4162
7922	7918	5	Apanylongo	4475
7923	7918	5	Gomi	3576
7924	7918	5	Ocamonyang	2309
7925	7918	5	Okile	2307
7926	7918	5	Okum	2489
7927	7918	5	Ororo	2316
7928	7917	4	Agweng	29645
7929	7928	5	Abala	4122
7930	7928	5	Acelela	2096
7931	7928	5	Angolocom	4109
7932	7928	5	Baroganda	3576
7933	7928	5	Dim	2734
7934	7928	5	Orit	5143
7935	7928	5	Te Adwong	4743
7936	7928	5	Te-Oburu	3122
7937	7917	4	Agweng Town Council	5329
7938	7937	5	Acelela Ward	1282
7939	7937	5	Agweng Ward	822
7940	7937	5	Amiabil Ward	444
7941	7937	5	Wiakot Ward	1999
7942	7937	5	Widam Ward	782
7943	7917	4	Amach	9950
7944	7943	5	Alworo	4078
7945	7943	5	Onyakede	5872
7946	7917	4	Amach Town Council	11522
7947	7946	5	Ayac Ward	6704
7948	7946	5	Banya Ward	4818
7949	7917	4	Aromo	21703
7950	7949	5	Apua	3501
7951	7949	5	Bar-Pii	5288
7952	7949	5	Odoca	1906
7953	7949	5	Odoro	4696
7954	7949	5	Otara	6312
7955	7917	4	Ayami	21176
7956	7955	5	Acutkumu	2593
7957	7955	5	Apuce	4635
7958	7955	5	Arwotomito	3526
7959	7955	5	Beo	2597
7960	7955	5	Okio	3756
7961	7955	5	Walela	4069
7962	7917	4	Barr	25615
7963	7962	5	Abunga	3576
7964	7962	5	Ayamo	3132
7965	7962	5	Ayira	4696
7966	7962	5	Ober	4489
7967	7962	5	Obot	4240
7968	7962	5	Opem	2374
7969	7962	5	Orem	3108
7970	7917	4	Itek	27093
7971	7970	5	Abolet	3307
7972	7970	5	Ajia	3867
7973	7970	5	Alebere	3989
7974	7970	5	Olilo	5385
7975	7970	5	Onywako	6900
7976	7970	5	Tetyang	3645
7977	7917	4	Ogur	41390
7978	7977	5	Adwoa	5369
7979	7977	5	Akangi	5108
7980	7977	5	Akano	4412
7981	7977	5	Akor	4301
7982	7977	5	Aler	3095
7983	7977	5	Alwala	2978
7984	7977	5	Apoka	2616
7985	7977	5	Lwala	3010
7986	7977	5	Ogur	4984
7987	7977	5	Okwaloamara	5517
7988	7917	4	Wiodyek	19462
7989	7988	5	Abutoadi	3454
7990	7988	5	Abwocolil	2702
7991	7988	5	Adola	2292
7992	7988	5	Amokogee	3548
7993	7988	5	Apiny Moo	2248
7994	7988	5	Rao	2327
7995	7988	5	Wiodyek	2891
7996	3	2	Lira City	245132
7997	7996	3	Lira East Division	123669
7998	7997	4	Lira East Division	123669
7999	7998	5	Abongoden Ward	2747
8000	7998	5	Acwao Ward	2236
8001	7998	5	Adekokwok Ward	6837
8002	7998	5	Akia Ward	4031
8003	7998	5	Akwiaworo Ward	2900
8004	7998	5	Angwetangwet Ward	11231
8005	7998	5	Anyangapuc Ward	4706
8006	7998	5	Anyomorem Ward	3139
8007	7998	5	Arumgai Ward	3476
8008	7998	5	Atego Ward	3298
8009	7998	5	Ayago Ward	3434
8010	7998	5	Baronger Ward	1315
8011	7998	5	Bazaar Ward	485
8012	7998	5	Boke Ward	11682
8013	7998	5	Boroboro East Ward	8391
8014	7998	5	Boroboro West Ward	8570
8015	7998	5	Burlobo Ward	5765
8016	7998	5	Cura Ward	4085
8017	7998	5	Ireda East Ward	7602
8018	7998	5	Ireda West Ward	9977
8019	7998	5	Iwal Ward	3014
8020	7998	5	Ongica Ward	2891
8021	7998	5	Ongura Ward	3291
8022	7998	5	Railway Quarters	1391
8023	7998	5	Sen. Quarters Ward	1735
8024	7998	5	Telela Ward	2639
8025	7998	5	Te-Mogo Ward	761
8026	7998	5	Te-Obia Ward	2040
8027	7996	3	Lira West Division	121463
8028	8027	4	Lira West Division	121463
8029	8028	5	Akwoyo	8644
8030	8028	5	Alito Camp	1698
8031	8028	5	Amuca	11681
8032	8028	5	Anai Ward	18881
8033	8028	5	Bar Ogole	3072
8034	8028	5	Bar-Apwo	14224
8035	8028	5	Blue Corner	753
8036	8028	5	Ipito Aweno	1468
8037	8028	5	Jinja Camp	2853
8038	8028	5	Junior Quarters	2127
8039	8028	5	Kakoge Ward	5737
8040	8028	5	Kirombe	2536
8041	8028	5	Lango Central	1811
8042	8028	5	Ober	7104
8043	8028	5	Obutowello	4899
8044	8028	5	Odokomit	5621
8045	8028	5	Omito	11796
8046	8028	5	Omitto Ward	6986
8047	8028	5	Starch Factory	4889
8048	8028	5	Teso A	3287
8049	8028	5	Teso C	1396
8050	2	2	Luuka	298639
8051	8050	3	Luuka North County	147664
8052	8051	4	Bukooma	30927
8053	8052	5	Bukooma	3870
8054	8052	5	Bukyangwa	6558
8055	8052	5	Naigobya	9545
8056	8052	5	Namasenda	6380
8057	8052	5	Namulanda	4574
8058	8051	4	Bukoova Town Council	20788
8059	8058	5	Bukanha Ward	1820
8060	8058	5	Bukoova Central Ward	1916
8061	8058	5	Bukoova Rural Ward	2393
8062	8058	5	Bunabala Ward	1336
8063	8058	5	Busanda Ward	2921
8064	8058	5	Butaserwa Ward	1526
8065	8058	5	Buyoga Ward	1425
8066	8058	5	Makuutu Ward	1693
8067	8058	5	Nabyoto Ward	3145
8068	8058	5	Nawansega Ward	2613
8069	8051	4	Bulongo	33148
8070	8069	5	Budhabangula	2997
8071	8069	5	Bugonyoka	4189
8072	8069	5	Bukendi	7354
8073	8069	5	Bulongo	3744
8074	8069	5	Nakabugu	8868
8075	8069	5	Namalemba	5996
8076	8051	4	Ikumbya	46853
8077	8076	5	Bunafu	6867
8078	8076	5	Ikumbya	10373
8079	8076	5	Inuula	8597
8080	8076	5	Nawaka	8412
8081	8076	5	Ntayigirwa	12604
8082	8051	4	Luuka Town Council	15948
8083	8082	5	Busimawu Ward	3409
8084	8082	5	Busonga	5231
8085	8082	5	Kitwekyambogo	2923
8086	8082	5	Kiyunga	2576
8087	8082	5	Lwada	1809
8088	8050	3	Luuka South County	150975
8089	8088	4	Bukanga	34977
8090	8089	5	Budondo	6286
8091	8089	5	Buwologoma	9704
8092	8089	5	Kiroba	5634
8093	8089	5	Nabubya	5811
8094	8089	5	Namukubembe	7542
8095	8088	4	Bulanga Town Council	15198
8096	8095	5	Bulanga	4694
8097	8095	5	Itwe	1237
8098	8095	5	Mawundo Ward	2437
8099	8095	5	Nantamu	6340
8100	8095	5	Walibo	490
8101	8088	4	Busalamu Town Council	10541
8102	8101	5	Busalamu East Ward	2229
8103	8101	5	Busalamu North Ward	1415
8104	8101	5	Busalamu South Ward	2594
8105	8101	5	Busalamu West Ward	4303
8106	8088	4	Irongo	26054
8107	8106	5	Irongo	8529
8108	8106	5	Kalyowa	2927
8109	8106	5	Kibinga	4626
8110	8106	5	Kyanvuma	4264
8111	8106	5	Nawanyago	5708
8112	8088	4	Kyanvuma Town Council	9475
8113	8112	5	Buniko	1834
8114	8112	5	Magada	2924
8115	8112	5	Nakabaale Ward	1992
8116	8112	5	Nakabambwe	1473
8117	8112	5	Nsimakatono	1252
8118	8088	4	Nawampiti	23586
8119	8118	5	Bugomba	3215
8120	8118	5	Buyoola	5570
8121	8118	5	Nakiswiga	4964
8122	8118	5	Nawampiti	5239
8123	8118	5	Nawankompe	4598
8124	8088	4	Waibuga	31144
8125	8124	5	Busiiro	8588
8126	8124	5	Butimbwa	9925
8127	8124	5	Itakaibolu	7179
8128	8124	5	Lwaki	5452
8129	1	2	Luweero	616242
8130	8129	3	Bamunanika County	243105
8131	8130	4	Bamunanika	34843
8132	8131	5	Kibanyi	4289
8133	8131	5	Kibirizi	3991
8134	8131	5	Kiteme	6693
8135	8131	5	Kyampisi (bamunanika)	10141
8136	8131	5	Mpologoma	2762
8137	8131	5	Sekamuli	6967
8138	8130	4	Busiika Town Council	42412
8139	8138	5	Busiika	17899
8140	8138	5	Busoke	4846
8141	8138	5	Kamira	5753
8142	8138	5	Vvumba	13914
8143	8130	4	Kalagala	28719
8144	8143	5	Ddegeya	7443
8145	8143	5	Kalanamu	8696
8146	8143	5	Kayindu	6504
8147	8143	5	Lunyolya	6076
8148	8130	4	Kamira	16035
8149	8148	5	Kitenderi	1511
8150	8148	5	Mabuye	5151
8151	8148	5	Mazzi	4575
8152	8148	5	Nambeere	4798
8153	8130	4	Kamira Town Council	18227
8154	8153	5	Buwanuka Ward	3045
8155	8153	5	Kabunyata	4174
8156	8153	5	Kamira Ward	4452
8157	8153	5	Katagwe Ward	3430
8158	8153	5	Makonkonyigo Ward	3126
8159	8130	4	Kikyusa	23191
8160	8159	5	Kibengo	7068
8161	8159	5	Kireku	5812
8162	8159	5	Kyampogola	3782
8163	8159	5	Wabusana	6529
8164	8130	4	Kikyusa Town Council	24478
8165	8164	5	Kikyusa Ward	14865
8166	8164	5	Kimazi Ward	2469
8167	8164	5	Kiziba Ward	4435
8168	8164	5	Wankanya Ward	2709
8169	8130	4	Zirobwe	38305
8170	8169	5	Bubuubi	5366
8171	8169	5	Kabulanaka	5536
8172	8169	5	Kakakala	1781
8173	8169	5	Kyetume	7663
8174	8169	5	Nakigoza	7381
8175	8169	5	Nambi	4630
8176	8169	5	Ngalonkalu	5948
8177	8130	4	Zirobwe Town Council	16895
8178	8177	5	Zirobwe Central Ward	5414
8179	8177	5	Zirobwe East Ward	4265
8180	8177	5	Zirobwe North Ward	3200
8181	8177	5	Zirobwe West Ward	4016
8182	8129	3	Katikamu County	373137
8183	8182	4	Bombo Town Council	29298
8184	8183	5	Bombo Central Ward	1636
8185	8183	5	Gangama Ward	2718
8186	8183	5	Lomule Ward	4295
8187	8183	5	Mpakawero Ward	2592
8188	8183	5	Namaliga Ward	11304
8189	8183	5	Nkokonjeru Ward	6753
8190	8182	4	Butuntumula	45181
8191	8190	5	Bamugolodde	8404
8192	8190	5	Bukambagga	3873
8193	8190	5	Kakabala	10909
8194	8190	5	Kakinzi	5497
8195	8190	5	Kalwanga	3225
8196	8190	5	Kyawangabi	5139
8197	8190	5	Ngogolo	8134
8198	8182	4	Katikamu	57107
8199	8198	5	Bukeeka	4071
8200	8198	5	Buyuki	6704
8201	8198	5	Kikoma	6548
8202	8198	5	Kyalugondo	7805
8203	8198	5	Migadde	12286
8204	8198	5	Musaale	12992
8205	8198	5	Tweyanze	6701
8206	8182	4	Luweero Town Council	73644
8207	8206	5	Kasana P.w.d Ward	8397
8208	8206	5	Kavule Ward	7402
8209	8206	5	Kiwogozi Ward	19648
8210	8206	5	Luwero Central Ward	1703
8211	8206	5	Luwero South East Ward	19957
8212	8206	5	Luwero West Ward	16537
8213	8182	4	Luwero	47111
8214	8213	5	Bwaziba	5519
8215	8213	5	Bweyeyo	4298
8216	8213	5	Kabakeddi	6113
8217	8213	5	Kagugo	9287
8218	8213	5	Kasaala	4843
8219	8213	5	Katugo	3776
8220	8213	5	Kigombe	5435
8221	8213	5	Kikube	3402
8222	8213	5	Nakikoota	4438
8223	8182	4	Makulubita	42272
8224	8223	5	Kagogo	3920
8225	8223	5	Kalasa	4507
8226	8223	5	Kangave	3160
8227	8223	5	Kanyanda	5304
8228	8223	5	Kasozi	5203
8229	8223	5	Makulubita	6110
8230	8223	5	Mawale	5654
8231	8223	5	Nsanvu	3593
8232	8223	5	Waluleeta	4821
8233	8182	4	Ndejje Town Council	9949
8234	8233	5	Buyego Ward	1864
8235	8233	5	Kiyana Ward	2782
8236	8233	5	Ndejje Ward	4312
8237	8233	5	Ssambwe Ward	991
8238	8182	4	Nyimbwa	32774
8239	8238	5	Bajjo	7802
8240	8238	5	Buvuma	4156
8241	8238	5	Kalule	6889
8242	8238	5	Kiyanda	5315
8243	8238	5	Nakatonya	8612
8244	8182	4	Wobulenzi Town Council	35801
8245	8244	5	Bukalasa Ward	1269
8246	8244	5	Bukolwa Ward	4909
8247	8244	5	Katikamu Ward	5473
8248	8244	5	Wobulenzi Central Ward	6084
8249	8244	5	Wobulenzi East Ward	12777
8250	8244	5	Wobulenzi West Ward	5289
8251	1	2	Lwengo	325263
8252	8251	3	Bukoto County	325263
8253	8252	4	Katovu Town Council	14783
8254	8253	5	Kakoma Ward	3240
8255	8253	5	Katovu Ward	7284
8256	8253	5	Ntuula Ward	4259
8257	8252	4	Kingo	24381
8258	8257	5	Kagganda	7584
8259	8257	5	Kasaana	5713
8260	8257	5	Kisansala	4489
8261	8257	5	Nkoni	6595
8262	8252	4	Kinoni Town Council	17137
8263	8262	5	Kinoni A Ward	4357
8264	8262	5	Kinoni B Ward	3042
8265	8262	5	Nakalembe A Ward	6344
8266	8262	5	Nakalembe B Ward	3394
8267	8252	4	Kisekka	43561
8268	8267	5	Busubi	6256
8269	8267	5	Kankamba	6463
8270	8267	5	Kikenene	6164
8271	8267	5	Kiwangala	12195
8272	8267	5	Nakatete	6052
8273	8267	5	Ngereko	6431
8274	8252	4	Kyazanga	43556
8275	8274	5	Bijaaba	12010
8276	8274	5	Kakoma	10476
8277	8274	5	Katuulo	10253
8278	8274	5	Lyakibiriizi	10817
8279	8252	4	Kyazanga Town Council	21754
8280	8279	5	Central Ward	4179
8281	8279	5	Kitooro Ward	5775
8282	8279	5	Lwentale Ward	4939
8283	8279	5	Nakateete Ward	6861
8284	8252	4	Lwengo	64562
8285	8284	5	Kalisizo	9906
8286	8284	5	Kito	12440
8287	8284	5	Kyawagonya	13263
8288	8284	5	Mbirizi	2742
8289	8284	5	Musubiro	7110
8290	8284	5	Nakyenyi	8925
8291	8284	5	Nkunyu	10176
8292	8252	4	Lwengo Town Council	18964
8293	8292	5	Central Ward	3175
8294	8292	5	Church Ward	2577
8295	8292	5	Kabalungi Ward	3384
8296	8292	5	Lwengo Ward	6094
8297	8292	5	Mulyazawo Ward	3734
8298	8252	4	Malongo	32062
8299	8298	5	Kalagala	11111
8300	8298	5	Katovu	7201
8301	8298	5	Kigeye	7654
8302	8298	5	Malongo	6096
8303	8252	4	Ndagwe	44503
8304	8303	5	Makondo	9957
8305	8303	5	Mpumudde	10193
8306	8303	5	Nanywa	9424
8307	8303	5	Ndagwe	14929
8308	1	2	Lyantonde	133017
8309	8308	3	Kabula County	133017
8310	8309	4	Kaliiro	21441
8311	8310	5	Kabatema	7119
8312	8310	5	Kasambya	4310
8313	8310	5	Kiyinda	4751
8314	8310	5	Kyakuterekera	5261
8315	8309	4	Kaliiro Town Council	6563
8316	8315	5	Kaliiro Central Ward	2382
8317	8315	5	Kaliiro Ward	2587
8318	8315	5	Katale Ward	1594
8319	8309	4	Kasagama	15240
8320	8319	5	Buyanja	3269
8321	8319	5	Kagara	2974
8322	8319	5	Katebe	2435
8323	8319	5	Kisaluwoko	4141
8324	8319	5	Namutamba	2421
8325	8309	4	Kinuuka	10666
8326	8325	5	Bwamulamira	3134
8327	8325	5	Nakasozi	3463
8328	8325	5	Wabusana	4069
8329	8309	4	Lyakajura	12949
8330	8329	5	Kicwamba	3957
8331	8329	5	Kyemamba	5150
8332	8329	5	Lyakajura	2689
8333	8329	5	Rweera	1153
8334	8309	4	Lyantonde	25540
8335	8334	5	Biwolobo	6826
8336	8334	5	Kalagala	5366
8337	8334	5	Katovu	5110
8338	8334	5	Kirowooza	2465
8339	8334	5	Kyewanula	5773
8340	8309	4	Lyantonde Town Council	19799
8341	8340	5	Kaliiro Ward	4483
8342	8340	5	Kooki Ward	15316
8343	8309	4	Mpumudde	20819
8344	8343	5	Buyaga	3933
8345	8343	5	Mpumudde	8367
8346	8343	5	Nsiika	5605
8347	8343	5	Rwamabara	2914
8348	3	2	Madi-Okollo	178051
8349	8348	3	Lower Madi County	113473
8350	8349	4	Ewanga	9441
8351	8350	5	Dumunga	2227
8352	8350	5	Ewanguru	2772
8353	8350	5	Kiranga	1187
8354	8350	5	Roga	1898
8355	8350	5	Waka - Dinya	1357
8356	8349	4	Inde Town Council	4708
8357	8356	5	Ayavu Ward	2734
8358	8356	5	Enyio Ward	1974
8359	8349	4	Ogoko	14424
8360	8359	5	Olali	5149
8361	8359	5	Pamvara	4913
8362	8359	5	Yachi	4362
8363	8349	4	Pawor	11112
8364	8363	5	Ndavu	1376
8365	8363	5	Olyevu	1855
8366	8363	5	Panduku	4698
8367	8363	5	Parabok	3183
8368	8349	4	Rhino Camp	14608
8369	8368	5	Anipi	3334
8370	8368	5	Bandili	4002
8371	8368	5	Gbulukuatuni	4728
8372	8368	5	Manago	2544
8373	8349	4	Rhino Camp Refugee Settlement	22096
8374	8373	5	Eden Zone	8414
8375	8373	5	Ocea Zone	6671
8376	8373	5	Oduobu Zone	1146
8377	8373	5	Tika Zone	5865
8378	8349	4	Rhino Camp Town Council	10547
8379	8378	5	Awuvu Ward	3698
8380	8378	5	Eramva Ward	2567
8381	8378	5	Ndara Ward	2455
8382	8378	5	Osioze Ward	1827
8383	8349	4	Rigbo	26537
8384	8383	5	Aliba	6662
8385	8383	5	Kwili	5121
8386	8383	5	Luba	6393
8387	8383	5	Ocea	2308
8388	8383	5	Odoi	4010
8389	8383	5	Odubu	2043
8390	8348	3	Upper Madi County	64578
8391	8390	4	Anyiribu	8978
8392	8391	5	Ayuu	1952
8393	8391	5	Bondo	2377
8394	8391	5	Omii	3110
8395	8391	5	Yilli	1539
8396	8390	4	Offaka	22474
8397	8396	5	Adraa	5646
8398	8396	5	Elibu	5109
8399	8396	5	Ocebu	4387
8400	8396	5	Oribu	7332
8401	8390	4	Okollo	15535
8402	8401	5	Ajibu	6029
8403	8401	5	Baito	3874
8404	8401	5	Onyomu	5632
8405	8390	4	Okollo Town Council	7088
8406	8405	5	Ayuu Ward	1095
8407	8405	5	Ndubu Ward	2330
8408	8405	5	Okollo Ward	2239
8409	8405	5	Oyhua Ward	1424
8410	8390	4	Uleppi	10503
8411	8410	5	Arara	2958
8412	8410	5	Katiyi	2929
8413	8410	5	Lawura	4616
8414	2	2	Manafwa	186917
8415	8414	3	Bubulo West County	118042
8416	8415	4	Bugobero	7190
8417	8416	5	Bumasokho	2568
8418	8416	5	Buwakoro	4622
8419	8415	4	Bugobero Town Council	9497
8420	8419	5	Bugobero Town Board	2107
8421	8419	5	Bunefule	2523
8422	8419	5	Khabungu Ward	1113
8423	8419	5	Kiwata	2758
8424	8419	5	Nabikulu	996
8425	8415	4	Bukewa	2762
8426	8425	5	Bukewa	506
8427	8425	5	Bunamutso	581
8428	8425	5	Buweboya	743
8429	8425	5	Nabulando	932
8430	8415	4	Bunabutsale	2777
8431	8430	5	Bamukhama	1360
8432	8430	5	Bunabutsale	870
8433	8430	5	Bunapondi	221
8434	8430	5	Bunapondi A	326
8435	8415	4	Busukuya	3118
8436	8435	5	Buwerayo	948
8437	8435	5	Namukhoge	1139
8438	8435	5	Sisatsa	1031
8439	8415	4	Butooto	4630
8440	8439	5	Bubukanza	745
8441	8439	5	Bumukhwana	959
8442	8439	5	Bunamukanda	449
8443	8439	5	Butoto	837
8444	8439	5	Buwesonga	889
8445	8439	5	Isanga	751
8446	8415	4	Butta	5305
8447	8446	5	Busantsa	1253
8448	8446	5	Butta	1213
8449	8446	5	Fuluma Butta	1600
8450	8446	5	Tooma Butta	1239
8451	8415	4	Buwagogo	5553
8452	8451	5	Bubwayo	827
8453	8451	5	Bunasaka	1110
8454	8451	5	Buwagogo	648
8455	8451	5	Nandubisi	1063
8456	8451	5	Narurwa	998
8457	8451	5	Shamukunga	907
8458	8415	4	Buwangani Town Council	5363
8459	8458	5	Bukhisa	915
8460	8458	5	Bukitutu	1128
8461	8458	5	Bunamubi	367
8462	8458	5	Buwamboko	584
8463	8458	5	Buwangani	628
8464	8458	5	Buwangani Town Board	591
8465	8458	5	Marongori	632
8466	8458	5	Nabikinji	518
8467	8415	4	Kaato	2656
8468	8467	5	Bukimanayi	464
8469	8467	5	Bumukari	501
8470	8467	5	Bunamungoma	408
8471	8467	5	Butuwa	688
8472	8467	5	Shiruku	595
8473	8415	4	Khabutoola	14642
8474	8473	5	Bumufuni I	3149
8475	8473	5	Bunangabo	3606
8476	8473	5	Busangayi	2239
8477	8473	5	Khabutoola	5648
8478	8415	4	Kimaluli	3019
8479	8478	5	Birari	237
8480	8478	5	Bukhinde	380
8481	8478	5	Bumatoola	340
8482	8478	5	Bunamukheya	553
8483	8478	5	Busike	703
8484	8478	5	Isunu	806
8485	8415	4	Lwanjusi	7084
8486	8485	5	Asinge	781
8487	8485	5	Bufumbula	1051
8488	8485	5	Kuruku	1649
8489	8485	5	Lwanjusi	1567
8490	8485	5	Puwa	1377
8491	8485	5	Raraka	659
8492	8415	4	Manafwa Town Council	15416
8493	8492	5	Bubulo	4245
8494	8492	5	Bubwaya	3530
8495	8492	5	Bumwangu	4113
8496	8492	5	Mayenze	3528
8497	8415	4	Masaka Town Council	5731
8498	8497	5	Bunamone	891
8499	8497	5	Butta	994
8500	8497	5	Buwekopyo	1699
8501	8497	5	Kimaluli	964
8502	8497	5	Masaka Town Board	1183
8503	8415	4	Nalondo	7560
8504	8503	5	Bumulekhwa	1560
8505	8503	5	Butsema	2041
8506	8503	5	Nalondo Butta	2453
8507	8503	5	Wanga	1506
8508	8415	4	Nangalwe	5422
8509	8508	5	Bugobero	1776
8510	8508	5	Bumufuni II	1234
8511	8508	5	Nangalwe	1290
8512	8508	5	Nekina	1122
8513	8415	4	Sibanga	5949
8514	8513	5	Bulako	895
8515	8513	5	Bumasari	662
8516	8513	5	Busangai	780
8517	8513	5	Buwasyeba	877
8518	8513	5	Mulukhu	791
8519	8513	5	Nabitawa	688
8520	8513	5	Namikelo	630
8521	8513	5	Syeba	626
8522	8415	4	Weswa	4368
8523	8522	5	Bunandutu	883
8524	8522	5	Bunatsabwana	579
8525	8522	5	Bungoolo	557
8526	8522	5	Bushaburiri	427
8527	8522	5	Buweswa	741
8528	8522	5	Nambewo	419
8529	8522	5	Shibanga	762
8530	8414	3	Butiru County	68875
8531	8530	4	Bukhadala	9009
8532	8531	5	Bukhadala	3011
8533	8531	5	Bumaena	2337
8534	8531	5	Bumatanda	1420
8535	8531	5	Khatsonga	2241
8536	8530	4	Bukhofu	5283
8537	8536	5	Bukhwaya	2172
8538	8536	5	Ikaali	1333
8539	8536	5	Nakhendo	1778
8540	8530	4	Bukoma	3557
8541	8540	5	Bukamukamu	277
8542	8540	5	Bukoma	1165
8543	8540	5	Buwanzala	1266
8544	8540	5	Kayombe	849
8545	8530	4	Bukusu	3593
8546	8545	5	Bukhwaya	524
8547	8545	5	Bumelele	617
8548	8545	5	Bunamukhosi	727
8549	8545	5	Bunyinza	601
8550	8545	5	Khaungu	566
8551	8545	5	Nambaale	558
8552	8530	4	Bunabwana	4959
8553	8552	5	Bunabwana	1325
8554	8552	5	Bunabwila	1005
8555	8552	5	Buwabula	1785
8556	8552	5	Nanderema	844
8557	8530	4	Butiru	4804
8558	8557	5	Bumatanda	689
8559	8557	5	Bumwalye	903
8560	8557	5	Bunakhaima	1130
8561	8557	5	Busyakilo	914
8562	8557	5	Buwopuwa	590
8563	8557	5	Nasyanda	578
8564	8530	4	Butiru Town Council	8575
8565	8564	5	Bumagambo	899
8566	8564	5	Bunabwana Ward	985
8567	8564	5	Busumbu	1927
8568	8564	5	Buwamalero	1704
8569	8564	5	Buwanyela	1341
8570	8564	5	Kholomo	1719
8571	8530	4	Buwaya Town Council	4388
8572	8571	5	Bubilumi	522
8573	8571	5	Bubutsatsa	489
8574	8571	5	Bunambwila Ward	887
8575	8571	5	Buwasibi	432
8576	8571	5	Buwaya Town Board	684
8577	8571	5	Buwaya Ward	827
8578	8571	5	Sinyifa Ward	547
8579	8530	4	Buyinza Town Council	7613
8580	8579	5	Bumabimba	1418
8581	8579	5	Bunabwana	1657
8582	8579	5	Bunakami	808
8583	8579	5	Bunyinza	3730
8584	8530	4	Maefe	4893
8585	8584	5	Bukhonzo	1542
8586	8584	5	Bumaefe	776
8587	8584	5	Matenge	1122
8588	8584	5	Tembelela	1453
8589	8530	4	Makenya	3548
8590	8589	5	Bukimiyu	524
8591	8589	5	Bumagira	245
8592	8589	5	Bumirumi	855
8593	8589	5	Bumufuni	1051
8594	8589	5	Makenya	873
8595	8530	4	Mayanza	2846
8596	8595	5	Bukhofu	534
8597	8595	5	Bumwangu	619
8598	8595	5	Buwanyama	769
8599	8595	5	Namaloko	924
8600	8530	4	Sisuni	5807
8601	8600	5	Bumagambo	1737
8602	8600	5	Kibukwa	1510
8603	8600	5	Makenya	936
8604	8600	5	Sisuni	1624
8605	3	2	Maracha	234712
8606	8605	3	Maracha County	97433
8607	8606	4	Agaii Town Council	9128
8608	8607	5	Godria Ward	3088
8609	8607	5	Motino Ward	2975
8610	8607	5	Ombachi Ward	3065
8611	8606	4	Awiziru	13173
8612	8611	5	Anzupi	2433
8613	8611	5	Minyoko	3203
8614	8611	5	Oluvu	2298
8615	8611	5	Robu	5239
8616	8606	4	Kijomoro	9609
8617	8616	5	Alivu	3298
8618	8616	5	Ambidro	2352
8619	8616	5	Kakwa	3959
8620	8606	4	Obiba	17928
8621	8620	5	Ayiko	2368
8622	8620	5	Baranya	2374
8623	8620	5	Draju	2112
8624	8620	5	Lamila	2488
8625	8620	5	Lega	1865
8626	8620	5	Nigo	1502
8627	8620	5	Nyogo	1357
8628	8620	5	Obica	2098
8629	8620	5	Rikabu	1764
8630	8606	4	Okokoro Town Council	12107
8631	8630	5	Dranzipi Ward	3523
8632	8630	5	Lamila Ward	4504
8633	8630	5	Poo Ward	4080
8634	8606	4	Olufe	15563
8635	8634	5	Kamaka	7367
8636	8634	5	Kimiru	6150
8637	8634	5	Mundru	2046
8638	8606	4	Oluvu	8438
8639	8638	5	Gbulukua	2633
8640	8638	5	Michu	2904
8641	8638	5	Nyamio	2901
8642	8606	4	Ovujo Town Council	11487
8643	8642	5	Otravu Ward	4102
8644	8642	5	Ovujo Central Ward	4144
8645	8642	5	Ovujo South Ward	3241
8646	8605	3	Maracha East County	137279
8647	8646	4	Ajira	9227
8648	8647	5	Aringa	2600
8649	8647	5	Ojapi	2794
8650	8647	5	Olupi	2294
8651	8647	5	Ombavu	1539
8652	8646	4	Alikua	13333
8653	8652	5	Alarapi	2780
8654	8652	5	Alikua	2138
8655	8652	5	Alipi	941
8656	8652	5	Aroi	2946
8657	8652	5	Egamara	1501
8658	8652	5	Ewavu	1576
8659	8652	5	Pakayo	1451
8660	8646	4	Drambu	10208
8661	8660	5	Buramali	2327
8662	8660	5	Gberemu	2109
8663	8660	5	Oniba	3660
8664	8660	5	Piago	2112
8665	8646	4	Maracha Town Council	16148
8666	8665	5	Adongoro Ward	1536
8667	8665	5	Ayiko Ward	2122
8668	8665	5	Baria Ward	1342
8669	8665	5	Bura Ward	2919
8670	8665	5	Central Zone Ward	3008
8671	8665	5	Odravu Ward	1083
8672	8665	5	Okapi Ward	3428
8673	8665	5	Ombia Ward	710
8674	8646	4	Nyadri	13424
8675	8674	5	Baria	2170
8676	8674	5	Kimuru	2745
8677	8674	5	Nyoroo	1518
8678	8674	5	Pabura	4816
8679	8674	5	Pabura West	2175
8680	8646	4	Nyadri South	10093
8681	8680	5	Midria	3045
8682	8680	5	Miridri	3335
8683	8680	5	Olevu	2172
8684	8680	5	Robu	1541
8685	8646	4	Oleba	12006
8686	8685	5	Azipi	3193
8687	8685	5	Bango	1520
8688	8685	5	Nyatika	2213
8689	8685	5	Robu	3414
8690	8685	5	Wodu	1666
8691	8646	4	Oleba Town Council	7375
8692	8691	5	Adakada Ward	1418
8693	8691	5	Central Ward	3409
8694	8691	5	Ewazoku Ward	1192
8695	8691	5	Tabia Ward	1356
8696	8646	4	Paranga	13578
8697	8696	5	Ajikoro	3638
8698	8696	5	Anguruma	2152
8699	8696	5	Etoko	2049
8700	8696	5	Obi	2484
8701	8696	5	Retriko	3255
8702	8646	4	Tara	15151
8703	8702	5	Anyivu	3028
8704	8702	5	Offude	2229
8705	8702	5	Pajama	1792
8706	8702	5	Vurra	3686
8707	8702	5	Wanguru	2234
8708	8702	5	Yiddu	2182
8709	8646	4	Yivu	16736
8710	8709	5	Amanipi	2406
8711	8709	5	Ambala	1996
8712	8709	5	Edre	1656
8713	8709	5	Loinya	2620
8714	8709	5	Okuvu	2071
8715	8709	5	Omba	1627
8716	8709	5	Ombia	2993
8717	8709	5	Ombia-Bura	1367
8718	1	2	Masaka	115455
8719	8718	3	Bukoto County	115455
8720	8719	4	Bukakata	22820
8721	8720	5	Bukibonga	11021
8722	8720	5	Makonzi	4380
8723	8720	5	Ssunga	7419
8724	8719	4	Buwunga	40497
8725	8724	5	Buwunga	6282
8726	8724	5	Ggulama	5250
8727	8724	5	Kamwozi	8464
8728	8724	5	Kanywa	9649
8729	8724	5	Kasaka	6008
8730	8724	5	Mazinga	4844
8731	8719	4	Kyanamukaka	29863
8732	8731	5	Buyaga	5881
8733	8731	5	Buyinja	3780
8734	8731	5	Kamuzinda	5011
8735	8731	5	Kyantale	8138
8736	8731	5	Zzimwe	7053
8737	8719	4	Kyesiiga	22275
8738	8737	5	Bbuliro	5503
8739	8737	5	Bugere	6056
8740	8737	5	Kitunga	4227
8741	8737	5	Kyesiiga	6489
8742	1	2	Masaka City	294166
8743	8742	3	Kimaanya-Kabonera Division	112297
8744	8743	4	Kimaanya-Kabonera Division	112297
8745	8744	5	Bisanje Ward	7964
8746	8744	5	Butale Ward	5319
8747	8744	5	Kakunyu Ward	5417
8748	8744	5	Kimaanya Ward	41633
8749	8744	5	Kirimya Ward	8967
8750	8744	5	Kitanga Ward	4250
8751	8744	5	Kiteredde Ward	10413
8752	8744	5	Kiziba Ward	4280
8753	8744	5	Kyabakuza Ward	12670
8754	8744	5	Kyamuyimbwa Ward	5355
8755	8744	5	Ssenya Ward	6029
8756	8742	3	Nyendo-Mukungwe Division	181869
8757	8756	4	Nyendo-Mukungwe Division	181869
8758	8757	5	Bugabira Ward	5689
8759	8757	5	Bulando Ward	4888
8760	8757	5	Bulayi Ward	6282
8761	8757	5	Butego Ward	19682
8762	8757	5	Kalagala Ward	30820
8763	8757	5	Kasanje Ward	6951
8764	8757	5	Katwadde Ward	7421
8765	8757	5	Katwe Ward	16661
8766	8757	5	Kibisi Ward	4120
8767	8757	5	Kitengeesa Ward	8007
8768	8757	5	Matanga Ward	8944
8769	8757	5	Nyendo Ward	37770
8770	8757	5	Samaliya Ward	12903
8771	8757	5	Senyange Ward	11731
8772	4	2	Masindi	342635
8773	8772	3	Bujenje County	125097
8774	8773	4	Bikonzi	19637
8775	8774	5	Bikonzi	6950
8776	8774	5	Kikube	4453
8777	8774	5	Kitonozi	3075
8778	8774	5	Rukondwa	5159
8779	8773	4	Budongo	21347
8780	8779	5	Bwinamira	5940
8781	8779	5	Karongo	6732
8782	8779	5	Kasongoire	5331
8783	8779	5	Nyabyeya	3344
8784	8773	4	Bulima Town Council	13708
8785	8784	5	Kahembe Ward	5882
8786	8784	5	Kisalizi Ward	3530
8787	8784	5	Marongo Ward	4296
8788	8773	4	Bwijanga	31364
8789	8788	5	Kahembe	3227
8790	8788	5	Kitamba	16913
8791	8788	5	Ntooma	11224
8792	8773	4	Kabango Town Council	13633
8793	8792	5	Kabango Ward	9043
8794	8792	5	Kapeeka Ward	1985
8795	8792	5	Kinyara Sugar L.t.d. Ward	2605
8796	8773	4	Nyantonzi	25408
8797	8796	5	Kajura	5339
8798	8796	5	Kasenene	5031
8799	8796	5	Kimanya	5431
8800	8796	5	Nyantonzi	5071
8801	8796	5	Rwempisi	4536
8802	8772	3	Buruli County	119757
8803	8802	4	Kijunjubwa	8263
8804	8803	5	Kijunjubwa	2211
8805	8803	5	Kyarutanga	2759
8806	8803	5	Miduma	3293
8807	8802	4	Kijunjubwa Town Council	4543
8808	8807	5	Bukooba Ward	1855
8809	8807	5	Kijunjubwa Ward	1458
8810	8807	5	Nyamukongo Ward	1230
8811	8802	4	Kimengo	8366
8812	8811	5	Kibangya	2575
8813	8811	5	Kimengo	5791
8814	8802	4	Kiruli	18249
8815	8814	5	Katuugo	4585
8816	8814	5	Kibibira	6886
8817	8814	5	Kiruli	6778
8818	8802	4	Kyatiri Town Council	10474
8819	8818	5	Kyatiri East Ward	5347
8820	8818	5	Kyatiri West Ward	5127
8821	8802	4	Labongo	21733
8822	8821	5	Kasenyi	5902
8823	8821	5	Kihaguzi	5681
8824	8821	5	Kihonda	4306
8825	8821	5	Labongo	5844
8826	8802	4	Miirya	26601
8827	8826	5	Bigando	9515
8828	8826	5	Isimba	5419
8829	8826	5	Kiguulya	11667
8830	8802	4	Pakanyi	21528
8831	8830	5	Kyakamese Central	7326
8832	8830	5	Kyakamese East	3953
8833	8830	5	Kyakamese West	7424
8834	8830	5	Kyangamyoyo	2825
8835	8772	3	Masindi Municipality	97781
8836	8835	4	Central Division	39877
8837	8836	5	Civic Centre Ward	9548
8838	8836	5	Southern Ward	13604
8839	8836	5	Western Ward	16725
8840	8835	4	Karujubu Division	26501
8841	8840	5	Kibwona Ward	7636
8842	8840	5	Kihuuba Ward	12452
8843	8840	5	Kisiita Ward	6413
8844	8835	4	Kigulya Division	16288
8845	8844	5	Bigando Ward	4754
8846	8844	5	Isimba Ward	6409
8847	8844	5	Kigulya Ward	5125
8848	8835	4	Nyangahya Division	15115
8849	8848	5	Kikwanana Ward	7220
8850	8848	5	Kiryanga Ward	7895
8851	2	2	Mayuge	577563
8852	8851	3	Bunya County	577563
8853	8852	4	Baitambogwe	48157
8854	8853	5	Bugodi	4596
8855	8853	5	Butte	5978
8856	8853	5	Igeyero	4818
8857	8853	5	Katonte	5928
8858	8853	5	Lugolole	11037
8859	8853	5	Lukone	4830
8860	8853	5	Mulingilire	6613
8861	8853	5	Wainha	4357
8862	8852	4	Bugadde Town Council	17638
8863	8862	5	Bugade Ward	11152
8864	8862	5	Busenda Ward	1401
8865	8862	5	Kityerera Ward	2929
8866	8862	5	Nakibengo Ward	2156
8867	8852	4	Bukabooli	49549
8868	8867	5	Bugoto	9807
8869	8867	5	Bugumia	7247
8870	8867	5	Bukabooli	6200
8871	8867	5	Buyugu	8772
8872	8867	5	Matovu	6352
8873	8867	5	Mayirinya	11171
8874	8852	4	Bukatube	52080
8875	8874	5	Bukaleba	8072
8876	8874	5	Buyemba	17971
8877	8874	5	Lwanika	13568
8878	8874	5	Mauta	5201
8879	8874	5	Mbirabira	7268
8880	8852	4	Busakira	34255
8881	8880	5	Bukunja	7912
8882	8880	5	Butangala	6394
8883	8880	5	Kaluuba	9009
8884	8880	5	Maumu	4781
8885	8880	5	Wambete	6159
8886	8852	4	Buwaaya	28145
8887	8886	5	Buwaiswa	6935
8888	8886	5	Buwolya	7650
8889	8886	5	Isikiro	5296
8890	8886	5	Kabaingirire	4147
8891	8886	5	Nsango	4117
8892	8852	4	Bwondha Town Council	26680
8893	8892	5	Bwondha Central Ward	5959
8894	8892	5	Bwondha South Ward	2578
8895	8892	5	Makonko Ward	5708
8896	8892	5	Musoma Ward	4300
8897	8892	5	Nalubabwe Ward	4459
8898	8892	5	Nkalanga Ward	3676
8899	8852	4	Imanyiro	37559
8900	8899	5	Bufulubi	7207
8901	8899	5	Magada	7820
8902	8899	5	Mayuge	7642
8903	8899	5	Mbaale	7282
8904	8899	5	Nkombe	7608
8905	8852	4	Jaguzi	17901
8906	8905	5	Bumba	2497
8907	8905	5	Jaguzi	5790
8908	8905	5	Kaaza	1496
8909	8905	5	Masolya	2836
8910	8905	5	Sagitu	3500
8911	8905	5	Serinyabi	1782
8912	8852	4	Kigandalo	39237
8913	8912	5	Bugondo	5099
8914	8912	5	Isenda	5914
8915	8912	5	Kigandalo	7630
8916	8912	5	Kigulu	7893
8917	8912	5	Kioga	6586
8918	8912	5	Maleka	6115
8919	8852	4	Kityerera	40156
8920	8919	5	Bubinge	7246
8921	8919	5	Bukalenzi	13488
8922	8919	5	Kitovu	6033
8923	8919	5	Ndaiga	7523
8924	8919	5	Wandegeya	5866
8925	8852	4	Magamaga Town Council	21741
8926	8925	5	Bukoli Ward	4579
8927	8925	5	Magamaga Ward	3359
8928	8925	5	Wabulungu Ward	10692
8929	8925	5	Wandago Ward	3111
8930	8852	4	Malongo	99278
8931	8930	5	Bukatabira	10418
8932	8930	5	Buluta	13298
8933	8930	5	Bumwena	42296
8934	8930	5	Malongo	19423
8935	8930	5	Namadhi	8336
8936	8930	5	Namoni	5507
8937	8852	4	Mayuge Town Council	20197
8938	8937	5	Ikulwe Ward	5911
8939	8937	5	Kasugu Ward	5902
8940	8937	5	Kavule Ward	4335
8941	8937	5	Kyebando Ward	4049
8942	8852	4	Mpungwe	30386
8943	8942	5	Buyere	3849
8944	8942	5	Maina	8158
8945	8942	5	Muggi	4297
8946	8942	5	Wairama	7536
8947	8942	5	Wamulongo	6546
8948	8852	4	Wairasa	14604
8949	8948	5	Busuyi	3444
8950	8948	5	Iguluibi	3294
8951	8948	5	Misoli	6126
8952	8948	5	Wandago	1740
8953	2	2	Mbale	290356
8954	8953	3	Bungokho Central County	126738
8955	8954	4	Bumbobi	21307
8956	8955	5	Bufuya	3289
8957	8955	5	Bukhumwa	5691
8958	8955	5	Bumbobi	8282
8959	8955	5	Busambe	4045
8960	8954	4	Bungokho	44424
8961	8960	5	Bubirabi	7770
8962	8960	5	Bumageni	11713
8963	8960	5	Bushikori	11072
8964	8960	5	Khamoto	9679
8965	8960	5	Lwambogo	4190
8966	8954	4	Busano	14013
8967	8966	5	Bufooto	4225
8968	8966	5	Busano	3616
8969	8966	5	Buyaka	3993
8970	8966	5	Bwikhonje	2179
8971	8954	4	Busoba	21064
8972	8971	5	Bumasikye	5769
8973	8971	5	Bunambutye	2345
8974	8971	5	Bunanimi	3219
8975	8971	5	Busoba	9731
8976	8954	4	Nabumali Town Council	16408
8977	8976	5	Bukuwa Ward	2299
8978	8976	5	Masikye Ward	5268
8979	8976	5	Mungoma Ward	2844
8980	8976	5	Nabumali Central Ward	1981
8981	8976	5	Southern Ward	1694
8982	8976	5	Wamwa Ward	2322
8983	8954	4	Nyondo	9522
8984	8983	5	Bubetsye	3951
8985	8983	5	Bufukhula	1942
8986	8983	5	Nabumali	468
8987	8983	5	Nyondo	3161
8988	8953	3	Bungokho County	163618
8989	8988	4	Bubyangu	25871
8990	8989	5	Bubyangu	2767
8991	8989	5	Bukikoso	3227
8992	8989	5	Bumadanda	2257
8993	8989	5	Bunabigubo	2642
8994	8989	5	Bunabuloli	1971
8995	8989	5	Bunamoli	2138
8996	8989	5	Bunawozi	1968
8997	8989	5	Kirayi	2508
8998	8989	5	Lusamenta	2249
8999	8989	5	Madege	4144
9000	8988	4	Budwale	8612
9001	9000	5	Budwale	1911
9002	9000	5	Bukingala	1703
9003	9000	5	Bunamahe	3135
9004	9000	5	Buwanagadi	1863
9005	8988	4	Bufumbo	10942
9006	9005	5	Bukobe	1561
9007	9005	5	Bumagira	2791
9008	9005	5	Bumusiri	2057
9009	9005	5	Bunamajje	1343
9010	9005	5	Buzalangizo	1246
9011	9005	5	Kama	1944
9012	8988	4	Bukhiende	32857
9013	9012	5	Bugwanyi	4245
9014	9012	5	Bumaena	3314
9015	9012	5	Bumutsopa	7512
9016	9012	5	Bunashimolo	5323
9017	9012	5	Burukuru	5910
9018	9012	5	Bushangi	3170
9019	9012	5	Isango	3383
9020	8988	4	Bumasikye	16576
9021	9020	5	Lubaale	2624
9022	9020	5	Lwaboba	5905
9023	9020	5	Muanda	4800
9024	9020	5	Toma	3247
9025	8988	4	Bunambutye	8768
9026	9025	5	Bunambutye	1346
9027	9025	5	Lwaboba	2508
9028	9025	5	Makunda	2001
9029	9025	5	Musese	2913
9030	8988	4	Busiu	14127
9031	9030	5	Bufukhula	3487
9032	9030	5	Bulusambu	5643
9033	9030	5	Buwalasi	1985
9034	9030	5	Lumbuku	3012
9035	8988	4	Busiu Town Council	14145
9036	9035	5	Alpha Ward	1721
9037	9035	5	Bufukhula Central Ward	1486
9038	9035	5	Bufukhula Ward	1293
9039	9035	5	Buwalasi Ward	1621
9040	9035	5	Central Ward	1801
9041	9035	5	Hospital Ward	1168
9042	9035	5	Kolan Ward	1309
9043	9035	5	Mabanga Ward	741
9044	9035	5	Namirembe Ward	1785
9045	9035	5	Town Ward	1220
9046	8988	4	Jewa Town Council	7384
9047	9046	5	Jewa Ward	1786
9048	9046	5	Kitagalu Ward	1467
9049	9046	5	Nakyanikile Ward	1089
9050	9046	5	Nalumoya Ward	2168
9051	9046	5	Ndoko Ward	874
9052	8988	4	Lukhonge	11895
9053	9052	5	Nabweye	2556
9054	9052	5	Namawanga	3588
9055	9052	5	Nambwa	2870
9056	9052	5	Waninda	2881
9057	8988	4	Wanale	12441
9058	9057	5	Bubentsye	2725
9059	9057	5	Bunatsoma	2703
9060	9057	5	Bushiuyo	3252
9061	9057	5	Khaukha	1969
9062	9057	5	Nabanyole	1792
9063	2	2	Mbale City	290414
9064	9063	3	Industrial Division	125203
9065	9064	4	Industrial Division	125203
9066	9065	5	Boma Ward	1855
9067	9065	5	Bukasakya Ward	7924
9068	9065	5	Bumboi Ward	2590
9069	9065	5	Bumutoto Ward	12902
9070	9065	5	Busamaga East Ward	2588
9071	9065	5	Busamaga West Ward	5874
9072	9065	5	Doko Ward	3936
9073	9065	5	Kijja Ward	1273
9074	9065	5	Malukhu Ward	7640
9075	9065	5	Marale Ward	9296
9076	9065	5	Masaba Ward	3272
9077	9065	5	Mooni-Nambale Ward	3176
9078	9065	5	Mooni-Wanale Ward	2202
9079	9065	5	Mukhubu Ward	3542
9080	9065	5	Muyanda Ward	2363
9081	9065	5	Nabitiri Ward	12859
9082	9065	5	Namalogo Ward	6745
9083	9065	5	Namatala Ward	16524
9084	9065	5	Napooli Central Ward	1278
9085	9065	5	Napooli Lower Ward	1647
9086	9065	5	Napooli Upper Ward	1104
9087	9065	5	South Central Ward	1939
9088	9065	5	Tsabanyanya Ward	8209
9089	9065	5	Wakhwaba Central Ward	1607
9090	9065	5	Wakhwaba Lower Ward	938
9091	9065	5	Wakhwaba Upper Ward	1920
9092	9063	3	Northern Division	165211
9093	9092	4	Northern Division	165211
9094	9093	5	Afya Ward	7668
9095	9093	5	Aisa Ward	6875
9096	9093	5	Bukikali	2589
9097	9093	5	Bulweta	6889
9098	9093	5	Bumuluya	3108
9099	9093	5	Bumuyanga	3175
9100	9093	5	Buwangolo	2670
9101	9093	5	Bwana Ward	2391
9102	9093	5	Doko Ward	5211
9103	9093	5	Fika Salama Ward	3553
9104	9093	5	Iu-Iu Ward	395
9105	9093	5	Kihuno	3272
9106	9093	5	Kireka-Nakaloke Sc Ward	1750
9107	9093	5	Kireka-Nakaloke Tc Ward	3198
9108	9093	5	Kolonyi Ward	1620
9109	9093	5	Lwasso	1746
9110	9093	5	Mukunja Ward	3448
9111	9093	5	Nabuyonga Ward	8854
9112	9093	5	Nabweya Ward	11374
9113	9093	5	Najja Ward	6218
9114	9093	5	Nakaloke Ward	7074
9115	9093	5	Namabasa Ward	6871
9116	9093	5	Namagumba Ward	7517
9117	9093	5	Namakwekwe Ward	11739
9118	9093	5	Nambulu/kasanja Ward	8515
9119	9093	5	Namunsi Ward	3244
9120	9093	5	Nanyunza	2737
9121	9093	5	Nkoma-Namanyonyi Ward	11716
9122	9093	5	Nkoma-Northern Ward	8700
9123	9093	5	North Central Ward	2759
9124	9093	5	Rock Ward	6087
9125	9093	5	Salem Ward	2248
9126	4	2	Mbarara	174039
9127	9126	3	Kashari North County	80326
9128	9127	4	Kagongi	24144
9129	9128	5	Bwengure	5109
9130	9128	5	Kibingo	3463
9131	9128	5	Kyandahi	2932
9132	9128	5	Ngango	4505
9133	9128	5	Nsiika	3182
9134	9128	5	Ntuura	4953
9135	9127	4	Kashare	19169
9136	9135	5	Mirongo	6438
9137	9135	5	Mitoozo	4471
9138	9135	5	Nchune	6774
9139	9135	5	Nyabisirira	1486
9140	9127	4	Nyabisirira Town Council	8251
9141	9140	5	Akaihamba Ward	1760
9142	9140	5	Kyenshama Ward	3643
9143	9140	5	Nyabisirira Ward	1058
9144	9140	5	Rugarura Ward	1790
9145	9127	4	Rubindi	12448
9146	9145	5	Kariro	4445
9147	9145	5	Nyamiriro	3813
9148	9145	5	Rwamuhiigi	4190
9149	9127	4	Rubindi-Ruhumba Town Council	16314
9150	9149	5	Bisya	3807
9151	9149	5	Kabare Ward	2456
9152	9149	5	Karuhama Ward	2625
9153	9149	5	Karwesanga(rugaaga)	4493
9154	9149	5	Rubindi Central Ward	2933
9155	9126	3	Kashari South County	93713
9156	9155	4	Bubaare	24540
9157	9156	5	Kamushoko	5575
9158	9156	5	Kashaka	3581
9159	9156	5	Katojo	1087
9160	9156	5	Mugarusya	6388
9161	9156	5	Rugarama	4527
9162	9156	5	Rwenshanku	3382
9163	9155	4	Bukiiro	6152
9164	9163	5	Nyarubungo	6152
9165	9155	4	Bukiiro Town Council	11359
9166	9165	5	Bukiro Ward	3916
9167	9165	5	Nyanja Ward	4115
9168	9165	5	Rubingo Ward	3328
9169	9155	4	Bwizibwera-Rutooma Town Council	18664
9170	9169	5	Bwizibwera Upper Ward	3929
9171	9169	5	Katyazo	3465
9172	9169	5	Rutoma Ward	5414
9173	9169	5	Rwebishekye	3617
9174	9169	5	Rwentojo Ward	2239
9175	9155	4	Rubaya	20942
9176	9175	5	Bunenero	4386
9177	9175	5	Itara	3715
9178	9175	5	Ruburara	3911
9179	9175	5	Ruhunga	4771
9180	9175	5	Rushozi	4159
9181	9155	4	Rwanyamahembe Town Council	12056
9182	9181	5	Bwizibwera Lower Ward	2038
9183	9181	5	Kakyerere Ward	2417
9184	9181	5	Karuyenje Ward	2316
9185	9181	5	Mabira	5285
9186	4	2	Mbarara City	264425
9187	9186	3	Mbarara North Division	102812
9188	9187	4	Mbarara North Division	102812
9189	9188	5	Biharwe East Ward	1639
9190	9188	5	Biharwe West Ward	5038
9191	9188	5	Bunutsya Ward	4181
9192	9188	5	Kakiika Ward	16284
9193	9188	5	Kakoma Ward	4417
9194	9188	5	Kamukuzi Ward	23161
9195	9188	5	Kishasha Ward	4536
9196	9188	5	Nyabuhama Ward	5254
9197	9188	5	Nyakinengo Ward	5362
9198	9188	5	Nyarubanga	7756
9199	9188	5	Ruharo Ward	13036
9200	9188	5	Rwemigyina Ward	6985
9201	9188	5	Rwenjeru Ward	5163
9202	9186	3	Mbarara South Division	161613
9203	9202	4	Mbarara South Division	161613
9204	9203	5	Bugashe Ward	4320
9205	9203	5	Kakoba Ward	40119
9206	9203	5	Katete Ward	42916
9207	9203	5	Katojo Ward	9233
9208	9203	5	Kichwamba Ward	7093
9209	9203	5	Nyamityobora Ward	22584
9210	9203	5	Nyarubungo II Ward	8376
9211	9203	5	Rukindo Ward	10466
9212	9203	5	Ruti Ward	8616
9213	9203	5	Rwakishakizi Ward	7890
9214	4	2	Mitooma	226009
9215	9214	3	Ruhinda County	73537
9216	9215	4	Kashenshero	15227
9217	9216	5	Bukari	3092
9218	9216	5	Bukuba	2455
9219	9216	5	Kirera	3744
9220	9216	5	Kyanzire	3859
9221	9216	5	Nyakatooma	2077
9222	9215	4	Kashenshero Town Council	7093
9223	9222	5	Kashenshero Central Ward	1924
9224	9222	5	Kashenshero Ward I	2048
9225	9222	5	Kashenshero Ward II	2140
9226	9222	5	Nyarubira-Burera Ward	981
9227	9215	4	Katenga	21341
9228	9227	5	Bitooma	5389
9229	9227	5	Igambiro	3650
9230	9227	5	Kirembe	6129
9231	9227	5	Rukararwe	6173
9232	9215	4	Mitooma	23056
9233	9232	5	Ijumo	6708
9234	9232	5	Katunda	2462
9235	9232	5	Mushunga	5023
9236	9232	5	Nkinga	4105
9237	9232	5	Nyakishojwa	4758
9238	9215	4	Mitooma Town Council	6820
9239	9238	5	Ward I	1932
9240	9238	5	Ward II	1003
9241	9238	5	Ward III	1993
9242	9238	5	Ward IV	1892
9243	9214	3	Ruhinda North County	79929
9244	9243	4	Bitereko	23209
9245	9244	5	Bugongo	4743
9246	9244	5	Busheregyenyi	5110
9247	9244	5	Karangara	3335
9248	9244	5	Karimbiro	5804
9249	9244	5	Kigarama	4217
9250	9243	4	Kanyabwanga	16231
9251	9250	5	Bwera	5667
9252	9250	5	Kati	3270
9253	9250	5	Rucence	4399
9254	9250	5	Rwamuniori	2544
9255	9250	5	Rwenkuriju	351
9256	9243	4	Kigyende	6102
9257	9256	5	Kanyabwanga	1816
9258	9256	5	Kashongorero	1453
9259	9256	5	Kibungo	1525
9260	9256	5	Rugarama	1308
9261	9243	4	Kiyanga	14126
9262	9261	5	Bukiriro	2766
9263	9261	5	Iraramira	2297
9264	9261	5	Kaburara	1472
9265	9261	5	Kashasha	4758
9266	9261	5	Kiyanga	2833
9267	9243	4	Rutookye Town Council	11130
9268	9267	5	Central Ward	2885
9269	9267	5	Kibare Ward	2774
9270	9267	5	Nyakatsiro Ward	3081
9271	9267	5	Sanga Ward	2390
9272	9243	4	Rwoburunga	9131
9273	9272	5	Kagati	2864
9274	9272	5	Keirabwa	1761
9275	9272	5	Ndurumo	1581
9276	9272	5	Rwoburunga	2925
9277	9214	3	Ruhinda South County	72543
9278	9277	4	Kabira	8021
9279	9278	5	Buharambo	2587
9280	9278	5	Nyabubare	1523
9281	9278	5	Nyakatete	2098
9282	9278	5	Rurehe North	1813
9283	9277	4	Kabira Town Council	5125
9284	9283	5	Karangara Ward	1653
9285	9283	5	Nyabubare Ward	1339
9286	9283	5	Nyakagongo Ward	763
9287	9283	5	Omukacence Ward	1370
9288	9277	4	Mayanga	14696
9289	9288	5	Katagata	2181
9290	9288	5	Mayanga	5828
9291	9288	5	Rwamujura	2820
9292	9288	5	Rwanja East	3867
9293	9277	4	Mutara	7592
9294	9293	5	Enshaka	1595
9295	9293	5	Kataho	1319
9296	9293	5	Mahwizi	1490
9297	9293	5	Nyakihita	1743
9298	9293	5	Ryakitanga	1445
9299	9277	4	Mutara Town Council	14003
9300	9299	5	Bikungu Ward	2468
9301	9299	5	Bukongoro Ward	3659
9302	9299	5	Furuma Ward	3469
9303	9299	5	Kyeibare Ward	4407
9304	9277	4	Nyakizinga	8579
9305	9304	5	Kikani	1392
9306	9304	5	Murambi	1304
9307	9304	5	Muti	1767
9308	9304	5	Nyakizinga	1908
9309	9304	5	Rubirizi	2208
9310	9277	4	Rurehe	14527
9311	9310	5	Rurehe South	4893
9312	9310	5	Rutooma	2576
9313	9310	5	Rwanja West	3011
9314	9310	5	Ryengyerero	4047
9315	1	2	Mityana	407386
9316	9315	3	Busujju County	102098
9317	9316	4	Bbanda	6268
9318	9317	5	Kayanga	3043
9319	9317	5	Mpongo	3225
9320	9316	4	Bbanda Town Council	9584
9321	9320	5	Bbanda Ward	3908
9322	9320	5	Buzibazzi Ward	2815
9323	9320	5	Kanyale Ward	2861
9324	9316	4	Butayunja	11079
9325	9324	5	Kitebere	1491
9326	9324	5	Kitongo	5825
9327	9324	5	Nakaziba (ggavu)	1406
9328	9324	5	Ngandwe	2357
9329	9316	4	Kakindu	20093
9330	9329	5	Kakindu Town Board	3977
9331	9329	5	Mwera	3394
9332	9329	5	Ngugulo	4609
9333	9329	5	Nsambya	4504
9334	9329	5	Vvumbe	3609
9335	9316	4	Maanyi	23376
9336	9335	5	Kasota	3122
9337	9335	5	Kimuli	2614
9338	9335	5	Kivuvvu	4276
9339	9335	5	Misigi	2590
9340	9335	5	Namutunku	4376
9341	9335	5	Nfumbye	2541
9342	9335	5	Sserinya	3857
9343	9316	4	Malangala	15473
9344	9343	5	Kanyanya	4106
9345	9343	5	Kiwawu	8297
9346	9343	5	Magonga	3070
9347	9316	4	Zigoti Town Council	16225
9348	9347	5	Nabattu Ward	5188
9349	9347	5	Zigoti Ward	11037
9350	9315	3	Mityana County	179179
9351	9350	4	Bulera	30637
9352	9351	5	Bakijulula	1440
9353	9351	5	Bulamu	2230
9354	9351	5	Bulera	3598
9355	9351	5	Kibaale	3046
9356	9351	5	Kibogo	1542
9357	9351	5	Kitemu	2293
9358	9351	5	Lusanja	1769
9359	9351	5	Miseebe	2561
9360	9351	5	Nabumbugu	2571
9361	9351	5	Nalyankanja	3365
9362	9351	5	Namutamba	3370
9363	9351	5	Namutidde	2852
9364	9350	4	Busunju Town Council	18391
9365	9364	5	Central Ward	6807
9366	9364	5	North Ward	5271
9367	9364	5	South Ward	2833
9368	9364	5	West Ward	3480
9369	9350	4	Kalangaalo	34165
9370	9369	5	Bujaayu	3431
9371	9369	5	Busembi	3283
9372	9369	5	Kalama	3005
9373	9369	5	Kalangaalo	3347
9374	9369	5	Kikube	2610
9375	9369	5	Kikuuta	2377
9376	9369	5	Kiryokya	3684
9377	9369	5	Kiteredde	2527
9378	9369	5	Kiyoganyi	3179
9379	9369	5	Kyamusisi	3635
9380	9369	5	Mutettema	3087
9381	9350	4	Kikandwa	38563
9382	9381	5	Bambula	5633
9383	9381	5	Kikandwa	5181
9384	9381	5	Kikunyu	7744
9385	9381	5	Luwunga	3974
9386	9381	5	Nakwaya	4756
9387	9381	5	Namigavu	4123
9388	9381	5	Namwene	2598
9389	9381	5	Wattuba	4554
9390	9350	4	Namungo	23823
9391	9390	5	Kasangula	2341
9392	9390	5	Kisaana	3821
9393	9390	5	Kiteete	6241
9394	9390	5	Mpirigwa	5034
9395	9390	5	Mugulu	2318
9396	9390	5	Namungo	4068
9397	9350	4	Ssekanyonyi	14060
9398	9397	5	Bukooba	5017
9399	9397	5	Kagerekamu	3255
9400	9397	5	Kasikombe	3025
9401	9397	5	Magala	2763
9402	9350	4	Ssekanyonyi Town Council	19540
9403	9402	5	Bulyankuyege Ward	2861
9404	9402	5	Kabbega Ward	4284
9405	9402	5	Kyetume Ward	1977
9406	9402	5	Ssekanyonyi Ward	10418
9407	9315	3	Mityana Municipality	126109
9408	9407	4	Busimbi Division	54209
9409	9408	5	East Ward	16298
9410	9408	5	Kireku Ward	4054
9411	9408	5	Naama Ward	10421
9412	9408	5	Nakaseeta Ward	4610
9413	9408	5	North Ward	18826
9414	9407	4	Central Division	27304
9415	9414	5	Central Ward	5699
9416	9414	5	Katakala Ward	7422
9417	9414	5	Nakibanga Ward	5114
9418	9414	5	West Ward	9069
9419	9407	4	Ttamu Division	44596
9420	9419	5	Busubizi Ward	5364
9421	9419	5	Kabule Ward	5957
9422	9419	5	Kabuwambo	4627
9423	9419	5	South Ward	12734
9424	9419	5	Ttamu Ward	11459
9425	9419	5	Ttanda Ward	4455
9426	3	2	Moroto	103639
9427	9426	3	Matheniko County	59468
9428	9427	4	Loputuk	19419
9429	9428	5	Acherer	3986
9430	9428	5	Looi	1330
9431	9428	5	Loputuk	2219
9432	9428	5	Lotirir	1452
9433	9428	5	Nachogorom	5233
9434	9428	5	Nataparakwangan	2752
9435	9428	5	Nawanatau	2447
9436	9427	4	Lotisan	8383
9437	9436	5	Lokisilei	2975
9438	9436	5	Loo-Arengak	1598
9439	9436	5	Loregait	1006
9440	9436	5	Mogoth	2804
9441	9427	4	Nadunget	11205
9442	9441	5	Kaloe	1052
9443	9441	5	Komaret	1337
9444	9441	5	Kotaruk	1139
9445	9441	5	Lokeriaut	1164
9446	9441	5	Naitakwae	3556
9447	9441	5	Nangorit	2957
9448	9427	4	Nadunget Town Council	5169
9449	9448	5	Lorikokwa Ward	2012
9450	9448	5	Nakamistae Ward	1023
9451	9448	5	Nakapelimen Ward	2134
9452	9427	4	Rupa	15292
9453	9452	5	Kapwaata	1969
9454	9452	5	Lobuneit	3143
9455	9452	5	Nakadeli	2510
9456	9452	5	Nakiloro	2232
9457	9452	5	Pupu	1950
9458	9452	5	Rupa	3488
9459	9426	3	Moroto Municipality	16769
9460	9459	4	North Division	5018
9461	9460	5	Boma North	3591
9462	9460	5	Boma South	1427
9463	9459	4	South Division	11751
9464	9463	5	Campswahili Chin	7909
9465	9463	5	Campswahili Juu	3842
9466	9426	3	Tepeth County	27402
9467	9466	4	Katikekile	10158
9468	9467	5	Kakingol	2280
9469	9467	5	Lia	3791
9470	9467	5	Musas	1345
9471	9467	5	Musupo	1097
9472	9467	5	Narengenya	1645
9473	9466	4	Tapac	17244
9474	9473	5	Katikekile	8781
9475	9473	5	Kodonyo	1811
9476	9473	5	Loyaraboth	396
9477	9473	5	Nakwanga	2055
9478	9473	5	Natumukale	400
9479	9473	5	Tapach	3801
9480	3	2	Moyo	109572
9481	9480	3	West Moyo County	109572
9482	9481	4	Aluru	12072
9483	9482	5	Aluru	3052
9484	9482	5	Ebihwa	2118
9485	9482	5	Lea	4152
9486	9482	5	Ramogi	2750
9487	9481	4	Dufile	10352
9488	9487	5	Akka	1357
9489	9487	5	Amuri	1070
9490	9487	5	Arra	1881
9491	9487	5	Chinyi	1685
9492	9487	5	Dufile (indridri)	1412
9493	9487	5	Lebubu	1463
9494	9487	5	Nzerea	1484
9495	9481	4	Laropi	7777
9496	9495	5	Gbalala	1766
9497	9495	5	Idrimari	2267
9498	9495	5	Laropi	1358
9499	9495	5	Panyanga	2386
9500	9481	4	Laropi Town Council	5570
9501	9500	5	Central Ward	1051
9502	9500	5	Idijo Ward	1529
9503	9500	5	Khidi Ward	1688
9504	9500	5	Meria Ward	1302
9505	9481	4	Lefori	8722
9506	9505	5	Coloa	1649
9507	9505	5	Gwere	2715
9508	9505	5	Masaloa	4358
9509	9481	4	Lefori Town Council	5206
9510	9509	5	Coloa Ward	1996
9511	9509	5	Ebwea Ward	1697
9512	9509	5	Maringu Ward	1513
9513	9481	4	Metu	14469
9514	9513	5	Ayipe	2331
9515	9513	5	Ayiro	2291
9516	9513	5	Erepi	2075
9517	9513	5	Lea	1466
9518	9513	5	Pameri	4161
9519	9513	5	Pamujo	2145
9520	9481	4	Moyo	20026
9521	9520	5	Afoji	3083
9522	9520	5	Eria	3378
9523	9520	5	Logoba	3633
9524	9520	5	Opi	4358
9525	9520	5	Vura	5574
9526	9481	4	Moyo Town Council	13974
9527	9526	5	Besia Ward	3546
9528	9526	5	Celecelea	5747
9529	9526	5	Central Ward	1823
9530	9526	5	Elenderea Ward	2858
9531	9481	4	Otce	11404
9532	9531	5	Abeso	2058
9533	9531	5	Alimo	1616
9534	9531	5	Eremi	3569
9535	9531	5	Pajakiri	1894
9536	9531	5	Pamoyi	2267
9537	1	2	Mpigi	326690
9538	9537	3	Mawokota County	326690
9539	9538	4	Buwama	23936
9540	9539	5	Bulunda	3988
9541	9539	5	Bunjako	10255
9542	9539	5	Kawumba	2973
9543	9539	5	Sango	6720
9544	9538	4	Buwama Town Council	31774
9545	9544	5	Bongole Ward	5697
9546	9544	5	Buyijja Ward	3066
9547	9544	5	Jalamba Ward	5068
9548	9544	5	Lubugumu Ward	3783
9549	9544	5	Mbizinya Ward	11053
9550	9544	5	Nabitete Ward	3107
9551	9538	4	Kammengo	55184
9552	9551	5	Butoolo	4793
9553	9551	5	Kammengo	8365
9554	9551	5	Kanyike	8494
9555	9551	5	Kyanja	7560
9556	9551	5	Luwala	4960
9557	9551	5	Lwaggwa/kibaanga	2933
9558	9551	5	Musa	12815
9559	9551	5	Muyira	5264
9560	9538	4	Kayabwe Town Council	22005
9561	9560	5	Busese Ward	3278
9562	9560	5	Kayabwe Ward	10240
9563	9560	5	Nabusanke Ward	5165
9564	9560	5	Nakibanga Ward	3322
9565	9538	4	Kiringente	36259
9566	9565	5	Kavule	10704
9567	9565	5	Kikondo	12331
9568	9565	5	Kiringente	3881
9569	9565	5	Kololo	2425
9570	9565	5	Sekiwunga	6918
9571	9538	4	Kituntu	27941
9572	9571	5	Bukemba	3073
9573	9571	5	Kagenda	8380
9574	9571	5	Kantiini	3863
9575	9571	5	Kasozi	3621
9576	9571	5	Luwunga	3284
9577	9571	5	Migamba	2997
9578	9571	5	Nkasi	2723
9579	9538	4	Mpigi Town Council	48461
9580	9579	5	Bumoozi Ward	6874
9581	9579	5	Kafumu Ward	1902
9582	9579	5	Kakoola Ward	3455
9583	9579	5	Konkoma Ward	4977
9584	9579	5	Kyali Ward	3985
9585	9579	5	Lwanga Ward	6643
9586	9579	5	Maziba Ward	6383
9587	9579	5	Ward A	4071
9588	9579	5	Ward B	4320
9589	9579	5	Ward C	3005
9590	9579	5	Ward D	2846
9591	9538	4	Muduma	55150
9592	9591	5	Bulerejje	2870
9593	9591	5	Jjeza	5586
9594	9591	5	Lugyo	23706
9595	9591	5	Magala	1948
9596	9591	5	Malima	6812
9597	9591	5	Mbazzi	5558
9598	9591	5	Tiribogo	8670
9599	9538	4	Nkozi	25980
9600	9599	5	Bukunge	4081
9601	9599	5	Golo	6448
9602	9599	5	Mugge	7393
9603	9599	5	Nindye	8058
9604	1	2	Mubende	522015
9605	9604	3	Buwekula County	136756
9606	9605	4	Butoloogo	32307
9607	9606	5	Kalama	6451
9608	9606	5	Kanyogoga	7313
9609	9606	5	Kidongo	5321
9610	9606	5	Kisagazi	7757
9611	9606	5	Kyeza	5465
9612	9605	4	Kiruuma	30776
9613	9612	5	Kasolokamponye	5824
9614	9612	5	Kijaagi	2550
9615	9612	5	Kirwanyi	6000
9616	9612	5	Kituule	6728
9617	9612	5	Makuukuulu	9674
9618	9605	4	Kiyuuni	25236
9619	9618	5	Katente	15233
9620	9618	5	Kijumba	10003
9621	9605	4	Madudu	48437
9622	9621	5	Kabulamuliro	11249
9623	9621	5	Kakenzi	7917
9624	9621	5	Kansambya	10753
9625	9621	5	Kikoma	4605
9626	9621	5	Naluwondwa	13913
9627	9604	3	Buwekula South County	76886
9628	9627	4	Kalonga	31049
9629	9628	5	Budibaga	4254
9630	9628	5	Busenya	6522
9631	9628	5	Gogwa	5036
9632	9628	5	Kabyuma	3249
9633	9628	5	Kalonga	8989
9634	9628	5	Kyabaduma	2999
9635	9627	4	Kayebe	12460
9636	9635	5	Busooba	1918
9637	9635	5	Butayunja	3060
9638	9635	5	Kayebe	3242
9639	9635	5	Kiryamenvu	1413
9640	9635	5	Rwamaboga	2827
9641	9627	4	Kitenga	13608
9642	9641	5	Bugonzi	6974
9643	9641	5	Gogonya	6634
9644	9627	4	Kyenda Town Council	19769
9645	9644	5	Kagoma Ward	7879
9646	9644	5	Kirangwa Ward	3788
9647	9644	5	Muleete	3544
9648	9644	5	Nalyankanja Ward	4558
9649	9604	3	Kasambya County	195075
9650	9649	4	Bagezza	11131
9651	9650	5	Kalagala	2213
9652	9650	5	Kijjojolo	4456
9653	9650	5	Mugungulu	4462
9654	9649	4	Kasambya	29321
9655	9654	5	Butuuti	2382
9656	9654	5	Kabbo	5003
9657	9654	5	Kamusongole	3949
9658	9654	5	Kirolero	3101
9659	9654	5	Kyakasa	4185
9660	9654	5	Lwegula	2609
9661	9654	5	Muyinayina	4069
9662	9654	5	Nkinga	4023
9663	9649	4	Kasambya Town Council	24588
9664	9663	5	Kasambya Ward	10371
9665	9663	5	Kirume Ward	2475
9666	9663	5	Kisizire Ward	1467
9667	9663	5	Lubona Ward	8029
9668	9663	5	Nakasaga Ward	2246
9669	9649	4	Kibalinga	44574
9670	9669	5	Kaabowa	9384
9671	9669	5	Kabubbu	6576
9672	9669	5	Kasaana	2030
9673	9669	5	Kibalinga A	8356
9674	9669	5	Kibalinga B	4753
9675	9669	5	Kisombwa	4488
9676	9669	5	Nkandwa	4956
9677	9669	5	Ntungamo	4031
9678	9649	4	Kigando	37896
9679	9678	5	Bubanda	4223
9680	9678	5	Dyangoma	3288
9681	9678	5	Kacwamango	4404
9682	9678	5	Kigando	4875
9683	9678	5	Kiyonga	9814
9684	9678	5	Lusiba	8404
9685	9678	5	Mugolodde	2888
9686	9649	4	Lubimbiri	13136
9687	9686	5	Kafundezi	1411
9688	9686	5	Kalokalungi	2094
9689	9686	5	Kitonzi	2091
9690	9686	5	Lubimbiri	4606
9691	9686	5	Maaya	2934
9692	9649	4	Nabingoola	15614
9693	9692	5	Kabalungi	3684
9694	9692	5	Kasasa	3426
9695	9692	5	Kiteera	4376
9696	9692	5	Kiyita	4128
9697	9649	4	Nabingoola Town Council	18815
9698	9697	5	Gwanika Ward	3565
9699	9697	5	Kajumiro Ward	3223
9700	9697	5	Kibaale Ward	4622
9701	9697	5	Lwemivubo Ward	1724
9702	9697	5	Nabingoola Ward	5681
9703	9604	3	Mubende Municipality	113298
9704	9703	4	East Division	38635
9705	9704	5	Kanseera Ward	8770
9706	9704	5	Kasaana Ward	12502
9707	9704	5	Kaweri Ward	4970
9708	9704	5	Kawumulwa Ward	9257
9709	9704	5	Kyaterekera Ward	3136
9710	9703	4	South Division	42789
9711	9710	5	Busaale Ward	5274
9712	9710	5	Gayaza Ward	5633
9713	9710	5	Kattabalanga Ward	4691
9714	9710	5	Kirungi Ward	5587
9715	9710	5	Kisekende Ward	10301
9716	9710	5	Lwabagabo Ward	11303
9717	9703	4	West Division	31874
9718	9717	5	Biwanga Ward	3728
9719	9717	5	Kasenyi/caltex Ward	4447
9720	9717	5	Katogo Ward	4009
9721	9717	5	Kayinja Ward	6295
9722	9717	5	Mijunwa Ward	4456
9723	9717	5	Nabikakala Ward	7165
9724	9717	5	Nakayima Ward	1774
9725	1	2	Mukono	929224
9726	9725	3	Mukono County	381833
9727	9726	4	Katosi Town Council	28125
9728	9727	5	Bunakijja Ward	2667
9729	9727	5	Kalengera Ward	2847
9730	9727	5	Katosi Ward	10422
9731	9727	5	Lugazi Ward	5445
9732	9727	5	Nsanja Ward	6744
9733	9726	4	Koome Islands	20806
9734	9733	5	Bugombe	3104
9735	9733	5	Busanga	7002
9736	9733	5	Lwomolo	6381
9737	9733	5	Mubembe	4319
9738	9726	4	Kyampisi	87303
9739	9738	5	Bulijjo	15680
9740	9738	5	Ddundu	15217
9741	9738	5	Kabembe	23367
9742	9738	5	Kyabakadde	23636
9743	9738	5	Ntonto	9403
9744	9726	4	Mpatta	20468
9745	9744	5	Kabanga	4223
9746	9744	5	Kiyanja	2191
9747	9744	5	Mpatta	3961
9748	9744	5	Mubanda	3503
9749	9744	5	Mugomba	1761
9750	9744	5	Nakalanda	2045
9751	9744	5	Ttaba	2784
9752	9726	4	Mpunge	16308
9753	9752	5	Lulagwe	3409
9754	9752	5	Mbazi	3963
9755	9752	5	Mpunge	5281
9756	9752	5	Ngombere	3655
9757	9726	4	Nakisunga	80648
9758	9757	5	Katente	5699
9759	9757	5	Kiyoola	9240
9760	9757	5	Kyabalogo	9319
9761	9757	5	Kyetume	9580
9762	9757	5	Namayiba	11315
9763	9757	5	Namuyenje	17182
9764	9757	5	Seeta-Nazigo	9721
9765	9757	5	Wankoba	8592
9766	9726	4	Nama	93450
9767	9766	5	Buliika	9786
9768	9766	5	Kasenge	15067
9769	9766	5	Katoogo	6589
9770	9766	5	Mpoma	17347
9771	9766	5	Namawojjolo	16757
9772	9766	5	Namubiru	27904
9773	9726	4	Ntenjeru-Kisoga Town Council	34725
9774	9773	5	Bugoye Ward	3213
9775	9773	5	Kisoga Ward	12933
9776	9773	5	Maziba Ward	1373
9777	9773	5	Mpumu Ward	3075
9778	9773	5	Ntenjeru-Ntanzi Ward	6382
9779	9773	5	Ssaayi Ward	4327
9780	9773	5	Terere Ward	3422
9781	9725	3	Mukono Municipality	305945
9782	9781	4	Goma Division	184923
9783	9782	5	Bukerere Ward	39393
9784	9782	5	Misindye Ward	35715
9785	9782	5	Nantabulirwa Ward	42433
9786	9782	5	Nyenje Ward	26577
9787	9782	5	Seeta Ward	40805
9788	9781	4	Mukono Central Division	121022
9789	9788	5	Ggulu Ward	29447
9790	9788	5	Namumira/anthony Ward	39432
9791	9788	5	Nsuube/kauga Ward	25533
9792	9788	5	Ntawo Ward	26610
9793	9725	3	Nakifuma County	241446
9794	9793	4	Kasawo	26134
9795	9794	5	Kakukuulu	5092
9796	9794	5	Kasana	4485
9797	9794	5	Kigogola	6727
9798	9794	5	Namaliri	9830
9799	9793	4	Kasawo Town Council	26176
9800	9799	5	Kabimbiri A Ward	6181
9801	9799	5	Kabimbiri B Ward	2927
9802	9799	5	Kasawo Ward	2693
9803	9799	5	Kasenge Ward	4599
9804	9799	5	Kitale Ward	7009
9805	9799	5	Kitovu Ward	2767
9806	9793	4	Kimenyedde	31229
9807	9806	5	Bukasa	7247
9808	9806	5	Kawongo	7950
9809	9806	5	Kiwafu	6515
9810	9806	5	Nanga	9517
9811	9793	4	Nagojje	21230
9812	9811	5	Kyajja	3088
9813	9811	5	Nagojje	6565
9814	9811	5	Nakibano	4577
9815	9811	5	Waggala	7000
9816	9793	4	Nakifuma-Naggalama Town Council	66547
9817	9816	5	Bamusuuta-Rural Ward	7065
9818	9816	5	Bandaali Ward	6510
9819	9816	5	Bubiro Ward	4043
9820	9816	5	Kigaga-Jomayi Ward	4654
9821	9816	5	Makukuba Ward	6577
9822	9816	5	Nabalanga Rural Ward	4935
9823	9816	5	Naggalama A Ward	8547
9824	9816	5	Naggalama B Ward	4811
9825	9816	5	Nakanyonyi-Nabbale Ward	7617
9826	9816	5	Nakifuma Ward	8238
9827	9816	5	Nankulabye Ward	3550
9828	9793	4	Namataba Town Council	22395
9829	9828	5	Namagunga Annex Ward	2417
9830	9828	5	Namagunga Ward	6773
9831	9828	5	Namataba A Ward	9844
9832	9828	5	Namataba B Ward	3361
9833	9793	4	Ntunda	16231
9834	9833	5	Kateete	1727
9835	9833	5	Kyabazaala	5458
9836	9833	5	Namayuba	2870
9837	9833	5	Ntunda	6176
9838	9793	4	Seeta - Namuganga	31504
9839	9838	5	Kayini	5737
9840	9838	5	Kitale	4075
9841	9838	5	Kituula	5794
9842	9838	5	Namanoga	8348
9843	9838	5	Namuganga	7550
9844	3	2	Nabilatuk	136785
9845	9844	3	Pian County	136785
9846	9845	4	Kosike	24916
9847	9846	5	Kalokwameri	11641
9848	9846	5	Kothike	8020
9849	9846	5	Nakayot	5255
9850	9845	4	Lolachat	34241
9851	9850	5	Lorukumo	3463
9852	9850	5	Lotaruk	16020
9853	9850	5	Nakuri	5536
9854	9850	5	Sakale	9222
9855	9845	4	Lorengedwat	15680
9856	9855	5	Kamaturu	3534
9857	9855	5	Narisae	7015
9858	9855	5	Nathinyonoit	5131
9859	9845	4	Nabilatuk	24710
9860	9859	5	Acegeretolim	5292
9861	9859	5	Lokaala	4075
9862	9859	5	Moru-Angibuin	3008
9863	9859	5	Nakobekobe	5168
9864	9859	5	Natapar-Arengan	5834
9865	9859	5	Natopojo	1333
9866	9845	4	Nabilatuk Town Council	20874
9867	9866	5	Arengesiep Ward	6868
9868	9866	5	Central Ward	4744
9869	9866	5	Lolet Ward	3023
9870	9866	5	Natopojo Ward	2466
9871	9866	5	Naupala Ward	3773
9872	9845	4	Natirae	16364
9873	9872	5	Angaro	3399
9874	9872	5	Korinyang	3483
9875	9872	5	Moru-Angamion	3956
9876	9872	5	Namerisiya	3105
9877	9872	5	Natirae	2421
9878	3	2	Nakapiripirit	111681
9879	9878	3	Chekwii County	69408
9880	9879	4	Kaawach	14635
9881	9880	5	Kaiku	3027
9882	9880	5	Lomorimor	3566
9883	9880	5	Loperot	5273
9884	9880	5	Moru-A-Ajore	844
9885	9880	5	Naabore	1925
9886	9879	4	Kakomongole	7177
9887	9886	5	Akuyam	2653
9888	9886	5	Nabolis	2326
9889	9886	5	Nakorete	2198
9890	9879	4	Loregae	15277
9891	9890	5	Alamacar	2298
9892	9890	5	Loregae	3831
9893	9890	5	Nakaale	3800
9894	9890	5	Naturum	5348
9895	9879	4	Loreng	15203
9896	9895	5	Kobeyon	2716
9897	9895	5	Loasam	3261
9898	9895	5	Loreng	3220
9899	9895	5	Nabulenger	3515
9900	9895	5	Nathinyonoit	2491
9901	9879	4	Namalu	17116
9902	9901	5	Kokuwuam	5549
9903	9901	5	Lokatapan	7584
9904	9901	5	Namatata	3983
9905	9878	3	Chekwii East County	42273
9906	9905	4	Lemusui	11628
9907	9906	5	Akokor	1873
9908	9906	5	Alapat	3161
9909	9906	5	Katabok	1933
9910	9906	5	Lokoma	1455
9911	9906	5	Ulingiro	3206
9912	9905	4	Moruita	10653
9913	9912	5	Karinga	3788
9914	9912	5	Komoret	2119
9915	9912	5	Moruita	4746
9916	9905	4	Nakapiripirit Town Council	6064
9917	9916	5	Katanga/township Ward	3151
9918	9916	5	Lobulio/lomuu Ward	1103
9919	9916	5	Lobuneit/lokoona Ward	1810
9920	9905	4	Tokora	13928
9921	9920	5	Nadip	2630
9922	9920	5	Namorotot	1339
9923	9920	5	Okwapon	4860
9924	9920	5	Tokora	5099
9925	1	2	Nakaseke	251398
9926	9925	3	Nakaseke Central County	75492
9927	9926	4	Kikamulo	24111
9928	9927	5	Kamuli	5990
9929	9927	5	Kapeke	4280
9930	9927	5	Kibose	4284
9931	9927	5	Luteete	3777
9932	9927	5	Magoma	3671
9933	9927	5	Wakayamba	2109
9934	9926	4	Kitto	15582
9935	9934	5	Bugambakimu	1160
9936	9934	5	Kasiiso	2953
9937	9934	5	Kitto	4276
9938	9934	5	Kivumu	7193
9939	9926	4	Kiwoko Town Council	13511
9940	9939	5	Kiwoko Central Ward	3045
9941	9939	5	Kiwoko East Ward	6235
9942	9939	5	Kiwoko South Ward	2687
9943	9939	5	Kiwoko West Ward	1544
9944	9926	4	Nakaseke Butalangu Town Council	5652
9945	9944	5	Bukoba Ward	965
9946	9944	5	Butalangu Ward	1770
9947	9944	5	Bwetagiro Ward	1508
9948	9944	5	Kyanya Ward	1409
9949	9926	4	Wakyato	16636
9950	9949	5	Kalagala	2890
9951	9949	5	Kirinda	3512
9952	9949	5	Kisoga	4700
9953	9949	5	Mijumwa	3880
9954	9949	5	Nakonge	1654
9955	9925	3	Nakaseke North County	33541
9956	9955	4	Kinoni	7784
9957	9956	5	Bidduku	2729
9958	9956	5	Bulyamusenyu	2909
9959	9956	5	Kyenshande	2146
9960	9955	4	Kinyogoga	6404
9961	9960	5	Buwana	1443
9962	9960	5	Kinyogoga	2713
9963	9960	5	Rukono	591
9964	9960	5	Rwoma	1657
9965	9955	4	Ngoma	11880
9966	9965	5	Katuugo	2009
9967	9965	5	Kigweri	2706
9968	9965	5	Kiteyongera	1944
9969	9965	5	Kyalusebeka	2756
9970	9965	5	Ngoma	2465
9971	9955	4	Ngoma Town Council	7473
9972	9971	5	Ngoma Central Ward	5673
9973	9971	5	Ngoma East Ward	732
9974	9971	5	Ngoma North Ward	435
9975	9971	5	Ngoma West Ward	633
9976	9925	3	Nakaseke South County	142365
9977	9976	4	Kaasangombe	24651
9978	9977	5	Bukuuku	4334
9979	9977	5	Bulyake	4880
9980	9977	5	Mpwedde	7209
9981	9977	5	Nakaseeta	5841
9982	9977	5	Sakabusolo	2387
9983	9976	4	Kapeeka	38468
9984	9983	5	Kalagala	6956
9985	9983	5	Kapeeka	13677
9986	9983	5	Kisimula	7122
9987	9983	5	Naluvule	6389
9988	9983	5	Namusaale	4324
9989	9976	4	Nakaseke	21237
9990	9989	5	Bulwadda	3234
9991	9989	5	Kasagga	4268
9992	9989	5	Kasambya	3155
9993	9989	5	Kigege	3717
9994	9989	5	Kyamutakasa	2745
9995	9989	5	Mifunya	4118
9996	9976	4	Nakaseke Town Council	9961
9997	9996	5	Kivule Ward	540
9998	9996	5	Nakaseke Central Ward	2433
9999	9996	5	Nakaseke East Ward	2634
10000	9996	5	Nakaseke North Ward	2807
10001	9996	5	Namirali Ward	1547
10002	9976	4	Semuto	32674
10003	10002	5	Kikandwa	2785
10004	10002	5	Kikyusa	6078
10005	10002	5	Kirema	6723
10006	10002	5	Kisega	3774
10007	10002	5	Migingye	6783
10008	10002	5	Segalye	6531
10009	9976	4	Semuto Town Council	15374
10010	10009	5	Health Centre Ward	3216
10011	10009	5	Katale Ward	4115
10012	10009	5	Lule Ward	2512
10013	10009	5	Posta Ward	3194
10014	10009	5	Transformer Ward	2337
10015	1	2	Nakasongola	226074
10016	10015	3	Budyebo County	94732
10017	10016	4	Lwabiyata	19482
10018	10017	5	Kansira	2821
10019	10017	5	Kikooge	3433
10020	10017	5	Nakayonza	2990
10021	10017	5	Nalukonge	6992
10022	10017	5	Namiika	3246
10023	10016	4	Lwampanga	15274
10024	10023	5	Kikoiro	3343
10025	10023	5	Kisaalizi	4464
10026	10023	5	Kiwembi	4859
10027	10023	5	Wajjala	2608
10028	10016	4	Lwampanga Town Council	10055
10029	10028	5	Lwampanga Central Ward	2073
10030	10028	5	Mbaari Ward	2713
10031	10028	5	Muwunami Ward	2776
10032	10028	5	Zengebe Ward	2493
10033	10016	4	Migeera Town Council	8176
10034	10033	5	Migeera Central Ward	3014
10035	10033	5	Migeera East Ward	3063
10036	10033	5	Migeera North Ward	947
10037	10033	5	Migeera West Ward	1152
10038	10016	4	Nabiswera	23020
10039	10038	5	Kalengede	4219
10040	10038	5	Katubba	3174
10041	10038	5	Kyamukonda	4042
10042	10038	5	Kyangogolo	4028
10043	10038	5	Mulonzi	3266
10044	10038	5	Namaasa	4291
10045	10016	4	Nakitoma	18725
10046	10045	5	Bujjabe	8128
10047	10045	5	Kasozi	1654
10048	10045	5	Kigweri	5807
10049	10045	5	Njeru	3136
10050	10015	3	Nakasongola County	131342
10051	10050	4	Kakooge	17028
10052	10051	5	Bamusuuta	1596
10053	10051	5	Kyabutaika	1676
10054	10051	5	Kyambogo	6481
10055	10051	5	Kyankonwa	3448
10056	10051	5	Kyeyindula	3827
10057	10050	4	Kakooge Town Council	13385
10058	10057	5	Kabaale Ward	2179
10059	10057	5	Kakooge Central Ward	3900
10060	10057	5	Kakooge North Ward	5883
10061	10057	5	Kibira Ward	1423
10062	10050	4	Kalongo	21668
10063	10062	5	Bamugolodde	4410
10064	10062	5	Kamirampango	4982
10065	10062	5	Kigejjo	3369
10066	10062	5	Kisuuma	2787
10067	10062	5	Kisweera-Mayinda	3444
10068	10062	5	Kiwambya	2676
10069	10050	4	Kalungi	15747
10070	10069	5	Irima	4700
10071	10069	5	Namungolo	4229
10072	10069	5	Wanzogi	6818
10073	10050	4	Katuugo Town Council	11852
10074	10073	5	Katuugo Central Ward	4867
10075	10073	5	Katuugo North Ward	2641
10076	10073	5	Katuugo South Ward	1574
10077	10073	5	Kiralamba Ward	2770
10078	10050	4	Kazwama Town Council	11710
10079	10078	5	Central Ward	1814
10080	10078	5	East Ward	4557
10081	10078	5	North Ward	3488
10082	10078	5	West Ward	1851
10083	10050	4	Mayirikiti Towncouncil	5376
10084	10083	5	Central Ward	2020
10085	10083	5	Kabazi Ward	1661
10086	10083	5	Kayisolo Ward	907
10087	10083	5	Kiswera Ward	788
10088	10050	4	Nakasongola Town Council	10638
10089	10088	5	Nakasongola Central Ward	4551
10090	10088	5	Nakasongola East Ward	3873
10091	10088	5	Nakasongola West Ward	2214
10092	10050	4	Wabinyonyi	23938
10093	10092	5	Kageri	3201
10094	10092	5	Kamuniina	1432
10095	10092	5	Kiwongoire	2225
10096	10092	5	Kyamuyingo	2917
10097	10092	5	Sasiira	3398
10098	10092	5	Sikye	2943
10099	10092	5	Wabigalo	3224
10100	10092	5	Wampiti	4598
10101	2	2	Namayingo	266716
10102	10101	3	Bukooli Island County	35749
10103	10102	4	Bukana	11113
10104	10103	5	Biisa	1031
10105	10103	5	Buduma	5874
10106	10103	5	Bugana	4208
10107	10102	4	Lolwe	10795
10108	10107	5	Hama	1559
10109	10107	5	Lolwe East	4644
10110	10107	5	Lolwe West	4592
10111	10102	4	Sigulu Islands	13841
10112	10111	5	Bumalenge	3678
10113	10111	5	Nampongwe	2774
10114	10111	5	Rabachi	2695
10115	10111	5	Sigulu Manga	2797
10116	10111	5	Sigulu Mukani	1897
10117	10101	3	Bukooli South County	91018
10118	10117	4	Buswale	32142
10119	10118	5	Bubango	2580
10120	10118	5	Bungecha	5753
10121	10118	5	Buswale	5651
10122	10118	5	Madowa	4152
10123	10118	5	Namayuge	7532
10124	10118	5	Nansuma	6474
10125	10117	4	Buyinja	33624
10126	10125	5	Gondohera	3847
10127	10125	5	Kifuyo	9412
10128	10125	5	Lwangosia	5911
10129	10125	5	Nsono	7091
10130	10125	5	Syanyonja	7363
10131	10117	4	Namayingo Town Council	25252
10132	10131	5	Budidi Ward	2496
10133	10131	5	Bulamba Ward	4722
10134	10131	5	Namayingo Central Ward	9010
10135	10131	5	Nambugu Ward	4065
10136	10131	5	Nasinu Ward	4959
10137	10101	3	Namayingo South County	139949
10138	10137	4	Banda	26646
10139	10138	5	Buchumba	7993
10140	10138	5	Bujwanga	10181
10141	10138	5	Lugala	8472
10142	10137	4	Banda Town Council	23706
10143	10142	5	Bukeda Ward	4057
10144	10142	5	Buwoya Ward	5569
10145	10142	5	Buyombo Ward	4233
10146	10142	5	Lutolo Ward	2800
10147	10142	5	Magooli Ward	4254
10148	10142	5	Nangera Ward	2793
10149	10137	4	Buhemba	34692
10150	10149	5	Buhemba	8645
10151	10149	5	Bukewa	6559
10152	10149	5	Buwongo	6998
10153	10149	5	Dohwe	6488
10154	10149	5	Sinde	6002
10155	10137	4	Mutumba	29396
10156	10155	5	Buchimo	9929
10157	10155	5	Lubango	8146
10158	10155	5	Mwema	11321
10159	10137	4	Mutumba Town Council	25509
10160	10159	5	Bulule Ward	3313
10161	10159	5	Hatumba Banja Ward	4799
10162	10159	5	Lubira Ward	5708
10163	10159	5	Mawa Ward	4294
10164	10159	5	Mutumba North Ward	3601
10165	10159	5	Mutumba South Ward	3794
10166	2	2	Namisindwa	257346
10167	10166	3	Bubulo East County	162705
10168	10167	4	Bubutu	10942
10169	10168	5	Bukiketi Town Board	863
10170	10168	5	Bumulika	3201
10171	10168	5	Bumuyonga	2092
10172	10168	5	Butsemayi	1722
10173	10168	5	Munamba Town Board	3064
10174	10167	4	Bubutu Town Council	7865
10175	10174	5	Bubutu Town Board	3133
10176	10174	5	Bumalanga Ward	1007
10177	10174	5	Bumandali Ward	1739
10178	10174	5	Bumusomi Ward	921
10179	10174	5	Busiuma Ward	1065
10180	10167	4	Bukiabi	9851
10181	10180	5	Bukiabi	2201
10182	10180	5	Bukokho	1349
10183	10180	5	Busereli	2112
10184	10180	5	Makhonge	1933
10185	10180	5	Sabino	2256
10186	10167	4	Bukokho	22294
10187	10186	5	Bukokho	4768
10188	10186	5	Bunamulingi	6955
10189	10186	5	Kaboole	4642
10190	10186	5	Soono	5929
10191	10167	4	Bumbo	7578
10192	10191	5	Bumbo	1453
10193	10191	5	Buwantsala	1111
10194	10191	5	Buwundu	625
10195	10191	5	Chesoma	1070
10196	10191	5	Kamusayi	2272
10197	10191	5	Kisekere	1047
10198	10167	4	Bumbo Town Council	15866
10199	10198	5	Bukisasati Ward	923
10200	10198	5	Bumbo Town Board	982
10201	10198	5	Busubende Ward	1506
10202	10198	5	Laaso Ward	1581
10203	10198	5	Lulangatsi Ward	2708
10204	10198	5	Lwanda Ward	1931
10205	10198	5	Mukhuyu Ward	1464
10206	10198	5	Namwenula Ward	703
10207	10198	5	Saboti Ward	2344
10208	10198	5	Sirekere Ward	833
10209	10198	5	Tsebumbeyi Ward	891
10210	10167	4	Bumityero	5673
10211	10210	5	Bumityero	412
10212	10210	5	Bumoyayo	497
10213	10210	5	Buwambwa	566
10214	10210	5	Komono	570
10215	10210	5	Makunya	1829
10216	10210	5	Mulondo	1799
10217	10167	4	Bumwoni	17651
10218	10217	5	Butemulani	3999
10219	10217	5	Bwiri	5118
10220	10217	5	Kaboyi	4447
10221	10217	5	Kisawayi	4087
10222	10167	4	Buwambwa	5543
10223	10222	5	Bukhonzo	647
10224	10222	5	Bumangasa	1038
10225	10222	5	Bumoyayo	997
10226	10222	5	Buwambwa	876
10227	10222	5	Mufutu Town Board	1056
10228	10222	5	Musiye	929
10229	10167	4	Lwakhakha Town Council	11373
10230	10229	5	Bukeemo Ward	2443
10231	10229	5	Bukhoma Ward	1347
10232	10229	5	Bukibayi Ward	2548
10233	10229	5	Butemulani Ward	1775
10234	10229	5	Buwuma Ward	2160
10235	10229	5	Lwakhakha Ward	1100
10236	10167	4	Magale	10454
10237	10236	5	Bukibeti	1432
10238	10236	5	Bumulika	1106
10239	10236	5	Busimaolya	1586
10240	10236	5	Butsebeni	3793
10241	10236	5	Maresi	1449
10242	10236	5	Naluwande	1088
10243	10167	4	Magale Town Council	8681
10244	10243	5	Bukuto Ward	1335
10245	10243	5	Busantsa Ward	1144
10246	10243	5	Butinduyi Ward	1516
10247	10243	5	Buwandyambi Ward	425
10248	10243	5	Buwesa Ward	962
10249	10243	5	Magale Ward	1399
10250	10243	5	Mission Ward	832
10251	10243	5	Nambewo Ward	1068
10252	10167	4	Mukhuyu	6327
10253	10252	5	Bunanyama	1358
10254	10252	5	Buteteya	1718
10255	10252	5	Butinduyi	757
10256	10252	5	Buwambwa	1151
10257	10252	5	Mufutu	1343
10258	10167	4	Nabitsikhi	6886
10259	10258	5	Bulutswala	1210
10260	10258	5	Bumukuluma	1414
10261	10258	5	Bumusomi	1664
10262	10258	5	Buwasiba	1491
10263	10258	5	Buyasere	1107
10264	10167	4	Namboko	8075
10265	10264	5	Bumoyayo	1175
10266	10264	5	Bumulika	1504
10267	10264	5	Busukuya	1133
10268	10264	5	Buwambingwa	2368
10269	10264	5	Buwasiba	1895
10270	10167	4	Namitsa	7646
10271	10270	5	Bukuto	876
10272	10270	5	Bulako	1075
10273	10270	5	Bumululu Town Board	996
10274	10270	5	Butselitsi	1439
10275	10270	5	Buwambwa	643
10276	10270	5	Buwesa	1491
10277	10270	5	Namitsa	1126
10278	10166	3	Namisindwa County	94641
10279	10278	4	Bukhabusi	6133
10280	10279	5	Bukhabikula	556
10281	10279	5	Bukhabusi	1231
10282	10279	5	Bukimaswa	469
10283	10279	5	Bukimwanga	836
10284	10279	5	Bumakunya	619
10285	10279	5	Bumatanda	447
10286	10279	5	Bumulanyi	516
10287	10279	5	Bumutundi	485
10288	10279	5	Butiiru	974
10289	10278	4	Bukhaweka	5424
10290	10289	5	Bubikala	1883
10291	10289	5	Bukhaweka	2037
10292	10289	5	Bunanganda	1504
10293	10278	4	Bukwhaweka Town Council	4589
10294	10293	5	Buketera Ward	489
10295	10293	5	Bulumba Ward	472
10296	10293	5	Bunamakhola Ward	695
10297	10293	5	Bunamboko Ward	627
10298	10293	5	Khamwando Ward	937
10299	10293	5	Kimuma Ward	744
10300	10293	5	Matsanza Ward	384
10301	10293	5	Nabumbo Ward	241
10302	10278	4	Bumumali	8298
10303	10302	5	Bukhabikula	1269
10304	10302	5	Bumumali	2066
10305	10302	5	Busekere	2022
10306	10302	5	Buttingu	1463
10307	10302	5	Majenga	603
10308	10302	5	Nantseko	875
10309	10278	4	Bungati	3576
10310	10309	5	Bukhasame	629
10311	10309	5	Bukhulyungu	842
10312	10309	5	Busela	370
10313	10309	5	Busibuta	992
10314	10309	5	Buwambete	743
10315	10278	4	Bupoto	7084
10316	10315	5	Bukibumbi	3184
10317	10315	5	Buwere	2179
10318	10315	5	Namisindwa	1721
10319	10278	4	Buwabwala	8075
10320	10319	5	Bumurwa	1758
10321	10319	5	Busambatsa I	1227
10322	10319	5	Busambatsa II	1360
10323	10319	5	Busambatsa Town Board	1055
10324	10319	5	Buwasu	2675
10325	10278	4	Buwatuwa	4583
10326	10325	5	Bulumela	1130
10327	10325	5	Bunakatembukha	349
10328	10325	5	Bunamitsa	828
10329	10325	5	Buwabwala	542
10330	10325	5	Buwatuwa	1089
10331	10325	5	Namawondo	645
10332	10278	4	Luwa Town Council	6517
10333	10332	5	Bufuma Ward	799
10334	10332	5	Bunambobi Ward	1282
10335	10332	5	Luwa Ward	1195
10336	10332	5	Nasilulu Ward	1131
10337	10332	5	Siakalo Ward	1231
10338	10332	5	Syanza Ward	879
10339	10278	4	Mukoto	5629
10340	10339	5	Bunamulunyi	1398
10341	10339	5	Maalo	1928
10342	10339	5	Makutano	2303
10343	10278	4	Namabya	11924
10344	10343	5	Bumusomi	3370
10345	10343	5	Buwasunguyi	2763
10346	10343	5	Masaaka	3070
10347	10343	5	Namunyali	2721
10348	10278	4	Namisindwa Town Council	7825
10349	10348	5	Bumurundi Ward	972
10350	10348	5	Buwandyambi Ward	978
10351	10348	5	Buwasiba Ward	1211
10352	10348	5	Buyaka Ward	1521
10353	10348	5	Kimundu Ward	998
10354	10348	5	Namisindwa Ward	2145
10355	10278	4	Tsekululu	14984
10356	10355	5	Bunabitu	2867
10357	10355	5	Bunambale	2849
10358	10355	5	Bunamwandu	4182
10359	10355	5	Bunasambi	2661
10360	10355	5	Busulwa	2425
10361	2	2	Namutumba	311339
10362	10361	3	Bukono County	95680
10363	10362	4	Ivukula	24416
10364	10363	5	Budomero	4947
10365	10363	5	Ivukula	1420
10366	10363	5	Kamudoke	1294
10367	10363	5	Kimenyulo	2069
10368	10363	5	Kirongo	4643
10369	10363	5	Kisewuzi	4910
10370	10363	5	Nabitula	5133
10371	10362	4	Ivukula Town Council	9882
10372	10371	5	Bugabula Ward	1614
10373	10371	5	Gasani Ward	863
10374	10371	5	Ivukula Ward	1252
10375	10371	5	Kakoola Ward	1567
10376	10371	5	Mpande Ward	1160
10377	10371	5	Nakazinga Ward	1458
10378	10371	5	Nawankima Ward	1968
10379	10362	4	Kibaale	18685
10380	10379	5	Kasozi	2604
10381	10379	5	Kibaale	3036
10382	10379	5	Kiranga	3266
10383	10379	5	Kisega	2692
10384	10379	5	Namakoko	3413
10385	10379	5	Nawangisa	3674
10386	10362	4	Kibale Town Council	11886
10387	10386	5	Bugumba Ward	1460
10388	10386	5	Mpulira Ward	2289
10389	10386	5	Nabisoigi Central Ward	3929
10390	10386	5	Nabisoigi Ward	2156
10391	10386	5	Nakyeere Ward	2052
10392	10362	4	Nabweyo	10058
10393	10392	5	Budatu	3629
10394	10392	5	Busini	3431
10395	10392	5	Nabweyo	2998
10396	10362	4	Nangonde	13504
10397	10396	5	Buwalira	2687
10398	10396	5	Iwungiro	1193
10399	10396	5	Kisega	2907
10400	10396	5	Lwatama	3135
10401	10396	5	Namakoko	3582
10402	10362	4	Nangonde Town Council	7249
10403	10402	5	Bunangwe Ward	873
10404	10402	5	Butimbo Ward	1402
10405	10402	5	Ikwizi Ward	424
10406	10402	5	Iwungiro Ward	1086
10407	10402	5	Kigunda Ward	1160
10408	10402	5	Kitaigalwa Ward	214
10409	10402	5	Nangonde Central Ward	584
10410	10402	5	Nangonde Ward	969
10411	10402	5	Nawandaka Ward	537
10412	10361	3	Busiki County	153782
10413	10412	4	Bugobi	9816
10414	10413	5	Buwanga	1724
10415	10413	5	Kibigo	596
10416	10413	5	Kisiiro	3517
10417	10413	5	Makenha	2250
10418	10413	5	Nakazinga	1729
10419	10412	4	Bugobi Town Council	9824
10420	10419	5	Bugobi B Ward	1447
10421	10419	5	Bugobi Central Ward	1455
10422	10419	5	Bugobi East Ward	1354
10423	10419	5	Bukenga Ward	2348
10424	10419	5	Kibigo Ward	1902
10425	10419	5	Town Side Ward	1318
10426	10412	4	Bulange	35072
10427	10426	5	Bubutya	4306
10428	10426	5	Bukenga	2801
10429	10426	5	Bulange	4041
10430	10426	5	Buwaga	4776
10431	10426	5	Kirerema	4113
10432	10426	5	Kisenyi	4424
10433	10426	5	Mpumiro	6846
10434	10426	5	Nawankofu	3765
10435	10412	4	Kizuba	21995
10436	10435	5	Igerera	5196
10437	10435	5	Kizuba	7495
10438	10435	5	Nakalokwe	3503
10439	10435	5	Nawansagwa	5801
10440	10412	4	Namutumba	21017
10441	10440	5	Ituba	5512
10442	10440	5	Kigalama	5265
10443	10440	5	Nakyeere	4464
10444	10440	5	Namato	3114
10445	10440	5	Nawampandu	2662
10446	10412	4	Namutumba Town Council	27400
10447	10446	5	Namutumba Central Ward	16661
10448	10446	5	Namutumba North Ward	5035
10449	10446	5	Namutumba South Ward	5704
10450	10412	4	Nawaikona	14046
10451	10450	5	Bukonte	5060
10452	10450	5	Kivule	2425
10453	10450	5	Nakawunzo	3423
10454	10450	5	Nawaikona	3138
10455	10412	4	Nsinze	10375
10456	10455	5	Bubago	3387
10457	10455	5	Bunyagwe	1908
10458	10455	5	Buwongo	1561
10459	10455	5	Isegero	3519
10460	10412	4	Nsinze Town Council	4237
10461	10460	5	Bukenhe Ward	470
10462	10460	5	Bukolo Ward	539
10463	10460	5	Buwongo A Ward	274
10464	10460	5	Buwongo B Ward	509
10465	10460	5	Buyunga Ward	302
10466	10460	5	Nabukalu Ward	281
10467	10460	5	Namasere Ward	401
10468	10460	5	Namavundu Ward	663
10469	10460	5	Nsinze Ward	798
10470	10361	3	Busiki North County	61877
10471	10470	4	Kagulu	8672
10472	10471	5	Bugiri	1403
10473	10471	5	Irwaniro	2176
10474	10471	5	Kagulu	2358
10475	10471	5	Nabweyo	2735
10476	10470	4	Kiwanyi	25147
10477	10476	5	Irondo	3464
10478	10476	5	Izirangobi	3857
10479	10476	5	Kiwanyi	4260
10480	10476	5	Mulama	4029
10481	10476	5	Nabinyonyi	4210
10482	10476	5	Namalemba	2154
10483	10476	5	Nambula	3173
10484	10470	4	Magada	11252
10485	10484	5	Buyange	2964
10486	10484	5	Kategere	3240
10487	10484	5	Magada North	3922
10488	10484	5	Magada South	1126
10489	10470	4	Mazuba	16806
10490	10489	5	Isita	1751
10491	10489	5	Kagaire	2709
10492	10489	5	Mazuba	3795
10493	10489	5	Mpeizya	2298
10494	10489	5	Nawanzali	2628
10495	10489	5	Nsoola	3625
10496	3	2	Napak	211830
10497	10496	3	Bokora County	110787
10498	10497	4	Apeitolim	37161
10499	10498	5	Achukudu	8575
10500	10498	5	Apeitolim	4544
10501	10498	5	Arengepuwa	9084
10502	10498	5	Kaiungatuk	3417
10503	10498	5	Kobulin	3105
10504	10498	5	Lomokori	3347
10505	10498	5	Narengekitoe	5089
10506	10497	4	Lokiteded Town Council	4125
10507	10506	5	Apungure Ward	733
10508	10506	5	Dartics Ward	1482
10509	10506	5	Senior Quarters Ward	1910
10510	10497	4	Lokopo	11449
10511	10510	5	Akalale	2011
10512	10510	5	Kayepas	1578
10513	10510	5	Longalom	1496
10514	10510	5	Lorikitae	2919
10515	10510	5	Namugit	3445
10516	10497	4	Lopei	16866
10517	10516	5	Lokudumo	4428
10518	10516	5	Lopeei	5695
10519	10516	5	Nakwamoru	6743
10520	10497	4	Matany	18303
10521	10520	5	Lokali	5331
10522	10520	5	Lokupoi	3512
10523	10520	5	Lokuwas	1119
10524	10520	5	Morulinga	2749
10525	10520	5	Nakicumet	5592
10526	10497	4	Matany Town Council	10792
10527	10526	5	Kololo Ward	3316
10528	10526	5	Matany East Ward	3231
10529	10526	5	Matany West Ward	1869
10530	10526	5	Napeipelu Ward	2376
10531	10497	4	Poron	12091
10532	10531	5	Kaethelem	2871
10533	10531	5	Komuturunyo	3518
10534	10531	5	Poron	5702
10535	10496	3	Bokora East County	101043
10536	10535	4	Iriiri	23470
10537	10536	5	Iriiri	11368
10538	10536	5	Namendera	3118
10539	10536	5	Tepeth	8984
10540	10535	4	Kangole Town Council	9537
10541	10540	5	Complex Ward	405
10542	10540	5	Lopida Ward	3734
10543	10540	5	Nasike Ward	2057
10544	10540	5	Senior Quarters Ward	3341
10545	10535	4	Lorengecora	19104
10546	10545	5	Cholichol	3811
10547	10545	5	Kokipurat	10164
10548	10545	5	Lolet	5129
10549	10535	4	Lotome	16472
10550	10549	5	Kalokengel East	2866
10551	10549	5	Kalokengel West	2773
10552	10549	5	Lomuno	4685
10553	10549	5	Moruongor	4202
10554	10549	5	Nariamaregae	1946
10555	10535	4	Nabwal	13429
10556	10555	5	Amedek	3498
10557	10555	5	Duol	2516
10558	10555	5	Kodike	2471
10559	10555	5	Nabwal	2515
10560	10555	5	Naminit	2429
10561	10535	4	Napak Town Council	8679
10562	10561	5	Kopopwa A Ward	969
10563	10561	5	Kopopwa B Ward	373
10564	10561	5	Lorengecora A Ward	4385
10565	10561	5	Lorengecora B Ward	2952
10566	10535	4	Ngoleriet	10352
10567	10566	5	Kautakou	1975
10568	10566	5	Nagule-Angolol	1361
10569	10566	5	Naitakwae	2995
10570	10566	5	Narengemoru	890
10571	10566	5	Nawaikorot	3131
10572	3	2	Nebbi	299398
10573	10572	3	Nebbi Municipality	49191
10574	10573	4	Abindu Division	19702
10575	10574	5	Abindu Ward	4073
10576	10574	5	Nebbi Hill Ward	5550
10577	10574	5	Nyacara Ward	10079
10578	10573	4	Central Division	10481
10579	10578	5	Central Zone Ward	2825
10580	10578	5	Jukiya Hill Ward	4588
10581	10578	5	Namthin Ward	3068
10582	10573	4	Thatha Division	19008
10583	10582	5	Forest Ward	9689
10584	10582	5	Namrwodho Ward	3427
10585	10582	5	Thatha Ward	5892
10586	10572	3	Padyere County	250207
10587	10586	4	Acana	9750
10588	10587	5	Pagwata North	1923
10589	10587	5	Pagwata South	2225
10590	10587	5	Pangere	1805
10591	10587	5	Pulum North	1971
10592	10587	5	Pulum South	1826
10593	10586	4	Akworo	32566
10594	10593	5	Kasato	6995
10595	10593	5	Kituna	6218
10596	10593	5	Murusi	5873
10597	10593	5	Ondier	3775
10598	10593	5	Pakolo	4377
10599	10593	5	Rero	5328
10600	10586	4	Alala	10483
10601	10600	5	Acwera	2695
10602	10600	5	Akaba	3751
10603	10600	5	Ocelo	1844
10604	10600	5	Vurr	2193
10605	10586	4	Atego	12347
10606	10605	5	Paminya Lower	3629
10607	10605	5	Paminya Upper	4781
10608	10605	5	Pamora Upper	3937
10609	10586	4	Erussi	36714
10610	10609	5	Abongo	6309
10611	10609	5	Pacaka	6746
10612	10609	5	Padolo	10826
10613	10609	5	Pajur	7346
10614	10609	5	Payera	5487
10615	10586	4	Jupangira	14192
10616	10615	5	Ayomu	4335
10617	10615	5	Goli	3769
10618	10615	5	Jupangira	3913
10619	10615	5	Pawong	2175
10620	10586	4	Kucwiny	18760
10621	10620	5	Got Aciku	1623
10622	10620	5	Lee	3742
10623	10620	5	Ndhethe	1492
10624	10620	5	Osigumvure	3805
10625	10620	5	Ramogi	3586
10626	10620	5	Ratuk	2964
10627	10620	5	Uduka	1548
10628	10586	4	Ndhew	24157
10629	10628	5	Abar East	4630
10630	10628	5	Abar West	6028
10631	10628	5	Adolo	6599
10632	10628	5	Oweko	6900
10633	10586	4	Nebbi	18672
10634	10633	5	Kalowang	5983
10635	10633	5	Koch Lower	2332
10636	10633	5	Koch Upper	3462
10637	10633	5	Omyer	6895
10638	10586	4	Nyaravur - Angal Town Council	25168
10639	10638	5	Angal Lower	4265
10640	10638	5	Angal Upper	3075
10641	10638	5	Mbaro East	8039
10642	10638	5	Mbaro West	4256
10643	10638	5	Pamora Lower	5533
10644	10586	4	Padwot	13031
10645	10644	5	Mvura	3018
10646	10644	5	Mvura West	3596
10647	10644	5	Olago	3893
10648	10644	5	Olago North	2524
10649	10586	4	Parombo	14894
10650	10649	5	Ossi Central	2778
10651	10649	5	Ossi East	2617
10652	10649	5	Ossi West	2501
10653	10649	5	Padel North	2052
10654	10649	5	Padel South	3024
10655	10649	5	Padel West	1922
10656	10586	4	Parombo Town Council	19473
10657	10656	5	Nyarugalo Ward	8327
10658	10656	5	Parwo East Ward	4476
10659	10656	5	Parwo West Ward	6670
10660	2	2	Ngora	213777
10661	10660	3	Kapir County	102963
10662	10661	4	Agirigiroi	18424
10663	10662	5	Abatai	2332
10664	10662	5	Agirigiroi	1974
10665	10662	5	Ajeelo	2236
10666	10662	5	Ajuket	2011
10667	10662	5	Akisim	1729
10668	10662	5	Kokong	2973
10669	10662	5	Oluwa	2643
10670	10662	5	Orisai	2526
10671	10661	4	Kapir	29658
10672	10671	5	Agule	3773
10673	10671	5	Ajesa	2183
10674	10671	5	Akarukei	2857
10675	10671	5	Atapar	3935
10676	10671	5	Kapir	6392
10677	10671	5	Koloin	3275
10678	10671	5	Omiito	4615
10679	10671	5	Omuriana	2628
10680	10661	4	Morukakise	14221
10681	10680	5	Ariet	4224
10682	10680	5	Kaler	2411
10683	10680	5	Kamodokima	4109
10684	10680	5	Morukakise	3477
10685	10661	4	Mukura	24447
10686	10685	5	Agogomit	3029
10687	10685	5	Ajeluk	3889
10688	10685	5	Akubui	4159
10689	10685	5	Kees	2512
10690	10685	5	Kokodu	3078
10691	10685	5	Kumel	2522
10692	10685	5	Madoch	3011
10693	10685	5	Olilim	2247
10694	10661	4	Mukura Town Council	16213
10695	10694	5	Adul Ward	4544
10696	10694	5	Akeit Ward	1693
10697	10694	5	Doyoro Ward	2334
10698	10694	5	Mukura Ward	2566
10699	10694	5	Okunguro Ward	5076
10700	10660	3	Ngora County	110814
10701	10700	4	Atoot	17888
10702	10701	5	Atoot	2641
10703	10701	5	Kaderun	3102
10704	10701	5	Kadok	2645
10705	10701	5	Kococwa	1952
10706	10701	5	Koile	2023
10707	10701	5	Ojukai	2786
10708	10701	5	Olukangor	2739
10709	10700	4	Kobwin	20775
10710	10709	5	Aciisa	2718
10711	10709	5	Akarukei	2280
10712	10709	5	Katengeto	831
10713	10709	5	Kobuin	2455
10714	10709	5	Kodike	3057
10715	10709	5	Okapel	2740
10716	10709	5	Omoo	2257
10717	10709	5	Pokor	1507
10718	10709	5	Tilling	2930
10719	10700	4	Ngora	21027
10720	10719	5	Apama	2618
10721	10719	5	Kalengo	6625
10722	10719	5	Moruirion	1738
10723	10719	5	Nyamongo	3268
10724	10719	5	Oteteen	2855
10725	10719	5	Tididiek	3923
10726	10700	4	Ngora Town Council	21488
10727	10726	5	Eastern Ward	7753
10728	10726	5	Northern Ward	4880
10729	10726	5	Southern Ward	5773
10730	10726	5	Western Ward	3082
10731	10700	4	Odwarat	20925
10732	10731	5	Agu	2168
10733	10731	5	Angod	2332
10734	10731	5	Kopege	4307
10735	10731	5	Ngora	3884
10736	10731	5	Odwarat	3520
10737	10731	5	Omaditok	4714
10738	10700	4	Opot Town Council	8711
10739	10738	5	Agule Ward	1111
10740	10738	5	Kakoda Ward	826
10741	10738	5	Kalengo Ward	941
10742	10738	5	Kalina Ward	1447
10743	10738	5	Nyaguo Ward	1128
10744	10738	5	Okito Ward	1094
10745	10738	5	Opot Ward	864
10746	10738	5	Oswara Ward	1300
10747	4	2	Ntoroko	114858
10748	10747	3	Ntoroko County	114858
10749	10748	4	Butungama	14627
10750	10749	5	Budiba	2389
10751	10749	5	Butungama	1849
10752	10749	5	Kasungu	3263
10753	10749	5	Kyabukunguru	2175
10754	10749	5	Masaka	2751
10755	10749	5	Nyakasenyi	2200
10756	10748	4	Bweramule	10904
10757	10756	5	Bugando	1747
10758	10756	5	Bweramule	1418
10759	10756	5	Haibale	1465
10760	10756	5	Rukora	978
10761	10756	5	Rwamabale	5296
10762	10748	4	Kanara	11953
10763	10762	5	Kajweka	3960
10764	10762	5	Katanga	1482
10765	10762	5	Kimara	515
10766	10762	5	Rwangara	1114
10767	10762	5	Rwenyana	4882
10768	10748	4	Kanara Town Council	10814
10769	10768	5	Kanara Ward	2224
10770	10768	5	Kanyansi Ward	1649
10771	10768	5	Ntoroko Ward	2151
10772	10768	5	Twanzane Ward	4790
10773	10748	4	Karugutu	11408
10774	10773	5	Busayiro	5577
10775	10773	5	Itojo	2683
10776	10773	5	Nyabikungu	1499
10777	10773	5	Nyambigha	1649
10778	10748	4	Karugutu Town Council	19070
10779	10778	5	Ibanda Ward	3599
10780	10778	5	Kacwamba Ward	3044
10781	10778	5	Kaghorwe Ward	2329
10782	10778	5	Karugutu Ward	5352
10783	10778	5	Nyabuhuru Ward	4746
10784	10748	4	Kibuuku Town Council	7741
10785	10784	5	Kibuuku East Ward	2841
10786	10784	5	Kibuuku North Ward	1357
10787	10784	5	Kibuuku South Ward	2392
10788	10784	5	Kibuuku West Ward	1151
10789	10748	4	Nombe	14543
10790	10789	5	Kyabandara	2310
10791	10789	5	Musandama	2989
10792	10789	5	Nombe	6113
10793	10789	5	Nyakatoke	3131
10794	10748	4	Rwebisengo	8058
10795	10794	5	Harukoba	927
10796	10794	5	Kiranga	2634
10797	10794	5	Majumba	1325
10798	10794	5	Makondo	2385
10799	10794	5	Mukimba	787
10800	10748	4	Rwebisengo Town Council	5740
10801	10800	5	Rwebisengo East Ward	1518
10802	10800	5	Rwebisengo North Ward	1603
10803	10800	5	Rwebisengo South Ward	1279
10804	10800	5	Rwebisengo West Ward	1340
10805	4	2	Ntungamo	552786
10806	10805	3	Kajara County	126521
10807	10806	4	Bwongyera	14943
10808	10807	5	Kitojo	5025
10809	10807	5	Nyabubare	3859
10810	10807	5	Rwanda	6059
10811	10806	4	Ihunga	17253
10812	10811	5	Butanda	6678
10813	10811	5	Kitondo	6314
10814	10811	5	Nyakibigi	4261
10815	10806	4	Kagarama Town Council	12300
10816	10815	5	Kagamba Ward	4769
10817	10815	5	Kagarama Central Ward	3111
10818	10815	5	Rutunguru Ward	4420
10819	10806	4	Kibatsi	10188
10820	10819	5	Nyamugoye	3327
10821	10819	5	Rukarango	3555
10822	10819	5	Rukoni	3306
10823	10806	4	Nyabihoko	15675
10824	10823	5	Kanyampumo	3315
10825	10823	5	Kiyaga	2442
10826	10823	5	Nkongoro	5299
10827	10823	5	Rukanga	4619
10828	10806	4	Nyabushenyi	9967
10829	10828	5	Ihema	1976
10830	10828	5	Kinoni	2502
10831	10828	5	Mukinga	1746
10832	10828	5	Nyabushenyi	3743
10833	10806	4	Nyamunuka Town Council	26212
10834	10833	5	Itereero Ward	4665
10835	10833	5	Kakiika Ward	2336
10836	10833	5	Katoomi Ward	3840
10837	10833	5	Kyabashenyi Ward	5805
10838	10833	5	Kyaruhuga Ward	4211
10839	10833	5	Nyamunuka Central Ward	5355
10840	10806	4	Rwamabondo Town Council	12252
10841	10840	5	Ibaare Ward	2525
10842	10840	5	Kibaruko Ward	4773
10843	10840	5	Rwamabondo Ward	4954
10844	10806	4	Rwashameire Town Council	7731
10845	10844	5	Central Ward	2356
10846	10844	5	Kakiika Ward	1627
10847	10844	5	Omukimwani Ward	1235
10848	10844	5	Western Ward	2513
10849	10805	3	Ntungamo Municipality	20760
10850	10849	4	Central Division	6745
10851	10850	5	Central Ward	2432
10852	10850	5	Kikoni Ward	4313
10853	10849	4	Eastern Division	7543
10854	10853	5	Kyamate Ward	6320
10855	10853	5	Park Ward	1223
10856	10849	4	Western Division	6472
10857	10856	5	Kahunga Ward	4277
10858	10856	5	Muko Ward	2195
10859	10805	3	Ruhaama County	145093
10860	10859	4	Itojo	12477
10861	10860	5	Itojo	7784
10862	10860	5	Ruhanga	4693
10863	10859	4	Kafunjo-Mirama Town Council	16075
10864	10863	5	Kafunjo Ward	3346
10865	10863	5	Kigando Ward	3059
10866	10863	5	Kyarwehunde Ward	3934
10867	10863	5	Mirama Ward	2486
10868	10863	5	Murambi Ward	3250
10869	10859	4	Kakukuru-Rwenanura Town Counci	19942
10870	10869	5	Kabungo Ward	4949
10871	10869	5	Kakukuru Ward	1509
10872	10869	5	Kicece Ward	1676
10873	10869	5	Kitashekwa Ward	1005
10874	10869	5	Kyenjojo Ward	1607
10875	10869	5	Mutojo Ward	2178
10876	10869	5	Rushebeya Ward	2444
10877	10869	5	Rwemiyaga Ward	2932
10878	10869	5	Rwenanura Ward	1642
10879	10859	4	Ntungamo	24911
10880	10879	5	Butare	5193
10881	10879	5	Kahunga	4870
10882	10879	5	Kikoni	3406
10883	10879	5	Nyarubaare	6859
10884	10879	5	Ruhoko	4583
10885	10859	4	Nyamukana Town Council	12280
10886	10885	5	Buhanama Ward	5827
10887	10885	5	Nyongozi Ward	6453
10888	10859	4	Nyarutuntu	12389
10889	10888	5	Karambi	1921
10890	10888	5	Kitembe	3226
10891	10888	5	Kizaara	3124
10892	10888	5	Nyaburiza	4118
10893	10859	4	Ruhaama	18464
10894	10893	5	Igurwa	1611
10895	10893	5	Katojo	3345
10896	10893	5	Ruhaama	5712
10897	10893	5	Rwamwire	3670
10898	10893	5	Rwengoma	4126
10899	10859	4	Ruhaama East	13463
10900	10899	5	Kahenda	3740
10901	10899	5	Kishami A	2079
10902	10899	5	Kishami B	840
10903	10899	5	Mitooma	3777
10904	10899	5	Rwemiriro	3027
10905	10859	4	Rweikiniro	15092
10906	10905	5	Kayenje	7989
10907	10905	5	Murambi	7103
10908	10805	3	Ruhaama East County	111437
10909	10908	4	Kitwe Town Council	20076
10910	10909	5	Bakiharire Ward	2951
10911	10909	5	Central Ward	4723
10912	10909	5	Kabimbiri Ward	3969
10913	10909	5	Kabobo Ward	1510
10914	10909	5	Nshenyi Ward	3042
10915	10909	5	Omukibare Ward	3881
10916	10908	4	Nyakyera	13195
10917	10916	5	Kataraka	3874
10918	10916	5	Kiyoora	4970
10919	10916	5	Ngoma	4351
10920	10908	4	Nyakyera Town Council	32724
10921	10920	5	Kagorora Ward	8647
10922	10920	5	Kibingo Ward	8702
10923	10920	5	Kiziiba Ward	7584
10924	10920	5	Ngomba Ward	7791
10925	10908	4	Rukoni East	15103
10926	10925	5	Kanyerere	2459
10927	10925	5	Kihanga	3584
10928	10925	5	Kyamwasha A	2047
10929	10925	5	Kyamwasha B	3865
10930	10925	5	Nyakibaare	3148
10931	10908	4	Rukoni West	19047
10932	10931	5	Nyakabaare	7089
10933	10931	5	Rukoni	11958
10934	10908	4	Rwoho Town Council	11292
10935	10934	5	Kirera Ward	1814
10936	10934	5	Kirungu Ward	1986
10937	10934	5	Kitojo Ward	1902
10938	10934	5	Mushasha Ward	1860
10939	10934	5	Nyakigufu Ward	1868
10940	10934	5	Rwoho Ward	1862
10941	10805	3	Rushenyi County	148975
10942	10941	4	Kayonza	11243
10943	10942	5	Kabasheshe	3443
10944	10942	5	Kijubwe	4014
10945	10942	5	Ruhega	3786
10946	10941	4	Ngoma	28789
10947	10946	5	Kashenyi	5100
10948	10946	5	Kizinga	5317
10949	10946	5	Mugyera	6033
10950	10946	5	Mukoni	3356
10951	10946	5	Nyakariro	4661
10952	10946	5	Ruhara	4322
10953	10941	4	Rubaare	22514
10954	10953	5	Kagugu	5320
10955	10953	5	Nyanga	6788
10956	10953	5	Nyarwanya	6053
10957	10953	5	Omungyenyi	4353
10958	10941	4	Rubaare Town Council	22263
10959	10958	5	Akatojo Ward	2565
10960	10958	5	Kagango Ward	5967
10961	10958	5	Kyabukuju Ward	4013
10962	10958	5	Nyamurindira	1997
10963	10958	5	Rukiiri	4180
10964	10958	5	Rweimiriro Ward	3541
10965	10941	4	Rugarama	24968
10966	10965	5	Kagongi	5614
10967	10965	5	Katungamo	5866
10968	10965	5	Ngomba	5666
10969	10965	5	Nyakabungo	7822
10970	10941	4	Rugarama North	12823
10971	10970	5	Kajumbajumba	1590
10972	10970	5	Kakanena	4093
10973	10970	5	Kamahuri	5093
10974	10970	5	Kyafoora	2047
10975	10941	4	Rwentobo-Rwahi Town Council	26375
10976	10975	5	Kaina Ward	8014
10977	10975	5	Katooma Ward	6870
10978	10975	5	Kiyanja Ward	5614
10979	10975	5	Kyobwe Ward	5877
10980	3	2	Nwoya	220593
10981	10980	3	Nwoya County	108032
10982	10981	4	Anaka (payira)	14891
10983	10982	5	Pabali	3696
10984	10982	5	Todora	4827
10985	10982	5	Ywaya	6368
10986	10981	4	Anaka Town Council	22113
10987	10986	5	Akago Ward	2951
10988	10986	5	Ceke Ward	8241
10989	10986	5	Labyei Ward	4015
10990	10986	5	Ogom Ward	6906
10991	10981	4	Got Apwoyo	10300
10992	10991	5	Bar Lyec	961
10993	10991	5	Obira	3433
10994	10991	5	Paminolango	3282
10995	10991	5	Tegot	2624
10996	10981	4	Lungulu	31917
10997	10996	5	Bajere	7238
10998	10996	5	Lebngec	4080
10999	10996	5	Lulyango	4819
11000	10996	5	Nyamokino	4373
11001	10996	5	Panokrac	11407
11002	10981	4	Purongo	14194
11003	11002	5	Pabit	129
11004	11002	5	Paromo	5045
11005	11002	5	Patira	5560
11006	11002	5	Pawatomero	3460
11007	10981	4	Purongo Town Council	14617
11008	11007	5	Bunga Ward	4071
11009	11007	5	Kibar Ward	3953
11010	11007	5	Lawora Ward	3653
11011	11007	5	Tangi Ward	2940
11012	10980	3	Nwoya East County	112561
11013	11012	4	Alero	22181
11014	11013	5	Bwobonam	4954
11015	11013	5	Kal	7244
11016	11013	5	Okura	6226
11017	11013	5	Panyabono	3757
11018	11012	4	Koch Goma Town Council	7865
11019	11018	5	Gei Ward	1375
11020	11018	5	Hima Ward	2483
11021	11018	5	Ocaga Ward	2546
11022	11018	5	Oterem Ward	1461
11023	11012	4	Koch-Goma	30692
11024	11023	5	Agonga	6874
11025	11023	5	Amar	6865
11026	11023	5	Coo-Rom	9576
11027	11023	5	Goma Kal	7377
11028	11012	4	Lii	39601
11029	11028	5	Langele	13042
11030	11028	5	Lii	8469
11031	11028	5	Lutuk	7685
11032	11028	5	Orum	10405
11033	11012	4	Paminyai	12222
11034	11033	5	Got Ringo	3020
11035	11033	5	Lalar	4020
11036	11033	5	Langol	3868
11037	11033	5	Pangur	1314
11038	3	2	Obongi	142983
11039	11038	3	Obongi County	142983
11040	11039	4	Aliba	12118
11041	11040	5	Aringajobi	3051
11042	11040	5	Drabijo	1691
11043	11040	5	Indilinga	1854
11044	11040	5	Odonga	4009
11045	11040	5	Rodo	1513
11046	11039	4	Ewafa	14190
11047	11046	5	Alibabito	2039
11048	11046	5	Dilokata	1844
11049	11046	5	Ewafa	3146
11050	11046	5	Foligo	2045
11051	11046	5	Malanga	1917
11052	11046	5	Otubanga	3199
11053	11039	4	Gimara	10091
11054	11053	5	Liwa	4414
11055	11053	5	Lomunga	2489
11056	11053	5	Maduga	3188
11057	11039	4	Itula	14331
11058	11057	5	Demgbele	1651
11059	11057	5	Kali	2447
11060	11057	5	Legu	2529
11061	11057	5	Morobi	5083
11062	11057	5	Waka	2621
11063	11039	4	Obongi Town Council	12767
11064	11063	5	Kilaaming	4552
11065	11063	5	Lionga	2379
11066	11063	5	Ngungu	1192
11067	11063	5	Rooma	2474
11068	11063	5	Yakinemiji	2170
11069	11039	4	Palorinya	8669
11070	11069	5	Paalujo	1966
11071	11069	5	Palorinya	2349
11072	11069	5	Ubbi	2129
11073	11069	5	Yenga	2225
11074	11039	4	Palorinya Refugee Settlement	70817
11075	11074	5	Base Camp Zone	8875
11076	11074	5	Zone I	19384
11077	11074	5	Zone II	18310
11078	11074	5	Zone III East	9153
11079	11074	5	Zone III West	15095
11080	3	2	Omoro	207339
11081	11080	3	Omoro County	113935
11082	11081	4	Acet Town Council	6568
11083	11082	5	Acet Central Ward	1469
11084	11082	5	Barolam Ward	1334
11085	11082	5	Lamincoba Ward	1255
11086	11082	5	Oratido Ward	1080
11087	11082	5	Romkituku Ward	1430
11088	11081	4	Akidi	11868
11089	11088	5	Kecokella	3273
11090	11088	5	Lwala	2884
11091	11088	5	Parak	3221
11092	11088	5	Te-Got	2490
11093	11081	4	Lakwana	11179
11094	11093	5	Lanenober	3700
11095	11093	5	Lujorongole	3926
11096	11093	5	Te-Opok	3553
11097	11081	4	Lakwaya	17129
11098	11097	5	Alwii	3041
11099	11097	5	Idure	3924
11100	11097	5	Loyoajonga	5253
11101	11097	5	Lukwir	4911
11102	11081	4	Lalogi	18765
11103	11102	5	Gem	5097
11104	11102	5	Idobo	4028
11105	11102	5	Jaka	3216
11106	11102	5	Laminonami	3209
11107	11102	5	Minja	3215
11108	11081	4	Odek	17147
11109	11108	5	Akoyo	4184
11110	11108	5	Dino	1575
11111	11108	5	Lamola	4104
11112	11108	5	Olam	3199
11113	11108	5	Opong	2387
11114	11108	5	Palaro	1698
11115	11081	4	Omoro Town Council	13630
11116	11115	5	Lagude Ward	1567
11117	11115	5	Laminlyeka Ward	2029
11118	11115	5	Opit Central Ward	4235
11119	11115	5	Parwech Ward	5799
11120	11081	4	Orapwoyo	17649
11121	11120	5	Binya	4081
11122	11120	5	Dawa	6346
11123	11120	5	Laminobong	1095
11124	11120	5	Lukwor	1229
11125	11120	5	Ogwari	2715
11126	11120	5	Oryang	2183
11127	11080	3	Tochi County	93404
11128	11127	4	Abuga	9639
11129	11128	5	Abuga	3246
11130	11128	5	Abwoch	3484
11131	11128	5	Bwobo	2909
11132	11127	4	Aremo	14806
11133	11132	5	Omunycong	3445
11134	11132	5	Palwo	3748
11135	11132	5	Patek	4018
11136	11132	5	Tekulu	3595
11137	11127	4	Bobi	21690
11138	11137	5	Aywee	2043
11139	11137	5	Kidikal	3551
11140	11137	5	Kulu Otit	7765
11141	11137	5	Paidongo	4445
11142	11137	5	Paidwe	3886
11143	11127	4	Koro	11129
11144	11143	5	Ibakara	3525
11145	11143	5	Labwoc	4089
11146	11143	5	Lagara	3515
11147	11127	4	Labora	17413
11148	11147	5	Abigedi	5686
11149	11147	5	Lapainat East	4041
11150	11147	5	Lapainat West	3613
11151	11147	5	Larwodo	4073
11152	11127	4	Ongako	14104
11153	11152	5	Kal	3849
11154	11152	5	Lwala	3974
11155	11152	5	Olabo	3352
11156	11152	5	Onyona	2929
11157	11127	4	Palenga Town Council	4623
11158	11157	5	Gudu Ward	1546
11159	11157	5	Ibar Ward	662
11160	11157	5	Iraa Ward	624
11161	11157	5	Oduku Ward	886
11162	11157	5	Odyak Ward	905
11163	3	2	Otuke	161069
11164	11163	3	Otuke County	65381
11165	11164	4	Adwari	11278
11166	11165	5	Adyerakonya	2585
11167	11165	5	Okee	2271
11168	11165	5	Okere	4534
11169	11165	5	Olarokwon	1888
11170	11164	4	Adwari Town Council	6065
11171	11170	5	Akwera Ward	2015
11172	11170	5	Aliwang Ward	1459
11173	11170	5	Omito Ward	1486
11174	11170	5	Otal Ward	1105
11175	11164	4	Alango	11352
11176	11175	5	Agweng	3090
11177	11175	5	Alango	3204
11178	11175	5	Amintenyo	3332
11179	11175	5	Aweayela	1726
11180	11164	4	Barjobi	12168
11181	11180	5	Amoyai	2026
11182	11180	5	Barjobi	2662
11183	11180	5	Barocok	3508
11184	11180	5	Ogoro	3972
11185	11164	4	Barjobi Town Council	2777
11186	11185	5	Barjobi West Ward	1636
11187	11185	5	Otongere Ward	1141
11188	11164	4	Okwang	11532
11189	11188	5	Abongower	3878
11190	11188	5	Arwotngo	2715
11191	11188	5	Olworngu	1488
11192	11188	5	Opejal	3451
11193	11164	4	Okwang Town Council	6107
11194	11193	5	Okwii Ward	3029
11195	11193	5	Yabwangi Ward	3078
11196	11164	4	Okwongo Town Council	4102
11197	11196	5	Abworoyere Ward	1509
11198	11196	5	Acoke Ward	726
11199	11196	5	Okwongo Ward	849
11200	11196	5	Owangokado Ward	1018
11201	11163	3	Otuke East County	95688
11202	11201	4	Ogor	20600
11203	11202	5	Anyalima	6160
11204	11202	5	Atangwata	4221
11205	11202	5	Oluro	4411
11206	11202	5	Omwonylee	5808
11207	11201	4	Ogwette	29451
11208	11207	5	Acan Pii	3759
11209	11207	5	Ajur	4256
11210	11207	5	Alir	6732
11211	11207	5	Amunga	3806
11212	11207	5	Atira	7202
11213	11207	5	Ogwete	3696
11214	11201	4	Olilim	18450
11215	11214	5	Alula	2534
11216	11214	5	Anepkide	3972
11217	11214	5	Angetta	4194
11218	11214	5	Gotojwang	7750
11219	11201	4	Olilim Town Council	4666
11220	11219	5	Apalamio Ward	1101
11221	11219	5	Awee Ward	1200
11222	11219	5	Olilim Ward	1157
11223	11219	5	Owinyo Ward	1208
11224	11201	4	Orum	13327
11225	11224	5	Abongorwot	3584
11226	11224	5	Alangi	2702
11227	11224	5	Anepmoroto	3865
11228	11224	5	Ating	3176
11229	11201	4	Otuke Town Council	9194
11230	11229	5	Alai Ward	1324
11231	11229	5	Barodugu Ward	3424
11232	11229	5	Oget Ward	2121
11233	11229	5	Olec Ward	2325
11234	3	2	Oyam	477464
11235	11234	3	Oyam County	477464
11236	11235	4	Aber	42420
11237	11236	5	Adyegi	9485
11238	11236	5	Akaka	11896
11239	11236	5	Atura	8832
11240	11236	5	Wirao	12207
11241	11235	4	Abok	23093
11242	11241	5	Ajerijeri	5256
11243	11241	5	Ariba	4019
11244	11241	5	Bar	4929
11245	11241	5	Barrio	5040
11246	11241	5	Itubara	3849
11247	11235	4	Acaba	34850
11248	11247	5	Abanya	5049
11249	11247	5	Anyeke	1676
11250	11247	5	Atekober	8164
11251	11247	5	Dogapio	6989
11252	11247	5	Obanga Ngeo	7444
11253	11247	5	Ogwangapur	5528
11254	11235	4	Aleka	35529
11255	11254	5	Abela	4312
11256	11254	5	Agwar	6637
11257	11254	5	Ajul	8072
11258	11254	5	Aleka	4984
11259	11254	5	Alibi	11524
11260	11235	4	Iceme	48688
11261	11260	5	Aloni	5606
11262	11260	5	Angom	3676
11263	11260	5	Angweta	7390
11264	11260	5	Aungu	3826
11265	11260	5	Awio	4589
11266	11260	5	Okwir	5331
11267	11260	5	Omiri	5185
11268	11260	5	Omolo	6490
11269	11260	5	Orupo	6595
11270	11235	4	Iceme Town Council	9292
11271	11270	5	Eastern Ward	4841
11272	11270	5	Western Ward	4451
11273	11235	4	Kamdini	35287
11274	11273	5	Juma	10553
11275	11273	5	Ocini	11723
11276	11273	5	Pukica	6879
11277	11273	5	Zambia	6132
11278	11235	4	Kamdini Town Council	13307
11279	11278	5	Eastern Ward	4198
11280	11278	5	Western Ward	9109
11281	11235	4	Loro	47091
11282	11281	5	Acanpii	7360
11283	11281	5	Adigo	7905
11284	11281	5	Agulurude	7507
11285	11281	5	Alidi	6904
11286	11281	5	Alutkot	9896
11287	11281	5	Opelere	7519
11288	11235	4	Loro Town Council	19029
11289	11288	5	Central Ward	5875
11290	11288	5	Eastern Ward	6384
11291	11288	5	Western Ward	6770
11292	11235	4	Minakulu	25591
11293	11292	5	Adel	3728
11294	11292	5	Kuluabura	14320
11295	11292	5	Opuk	7543
11296	11235	4	Minakulu Town Council	25771
11297	11296	5	Aceno Ward	4951
11298	11296	5	Adel Ward	2860
11299	11296	5	Atego Ward	6939
11300	11296	5	Atek Ward	4533
11301	11296	5	Okule Ward	2048
11302	11296	5	Omolo Ward	4440
11303	11235	4	Myene	36557
11304	11303	5	Acimi	10201
11305	11303	5	Amwa	7305
11306	11303	5	Myene	6382
11307	11303	5	Oyoro	5374
11308	11303	5	Zuma	7295
11309	11235	4	Ngai	34749
11310	11309	5	Acut	6390
11311	11309	5	Akuca	4428
11312	11309	5	Aramita	9370
11313	11309	5	Kulakula	5096
11314	11309	5	Okomo	4936
11315	11309	5	Omach	4529
11316	11235	4	Otwal	32758
11317	11316	5	Acokara	5120
11318	11316	5	Ader	5266
11319	11316	5	Amukugungu	3589
11320	11316	5	Anyomolyec	7455
11321	11316	5	Okii	7696
11322	11316	5	Wanglobo	3632
11323	11235	4	Oyam Town Council	13452
11324	11323	5	Eastern Ward	6400
11325	11323	5	Western Ward	7052
11326	3	2	Pader	240159
11327	11326	3	Aruu County	96121
11328	11327	4	Awere	15536
11329	11328	5	Agweng	2076
11330	11328	5	Angole	2848
11331	11328	5	Atede	3960
11332	11328	5	Bolo	4328
11333	11328	5	Kal	2324
11334	11327	4	Lunyiri	9880
11335	11334	5	Koc	3614
11336	11334	5	Lagile	1956
11337	11334	5	Opok Rom	1835
11338	11334	5	Rackoko	2475
11339	11327	4	Ogom	8510
11340	11339	5	Gulnam	1405
11341	11339	5	Kiteny	1153
11342	11339	5	Ogom	2830
11343	11339	5	Otong	1344
11344	11339	5	Owelle	1778
11345	11327	4	Pader	10035
11346	11345	5	Kilak	2946
11347	11345	5	Ogwil	1537
11348	11345	5	Ongany	2762
11349	11345	5	Tyer	2790
11350	11327	4	Pader Town Council	17704
11351	11350	5	Acoro Ward	5381
11352	11350	5	Lagwai Ward	7667
11353	11350	5	Luna Ward	4656
11354	11327	4	Pukor	7250
11355	11354	5	Kal Angore	1840
11356	11354	5	Kineni	2399
11357	11354	5	Olam	1299
11358	11354	5	Pukor	1712
11359	11327	4	Puranga	14158
11360	11359	5	Agwel	2630
11361	11359	5	Apwor	2179
11362	11359	5	Laminajiko	2736
11363	11359	5	Laminocwida	2467
11364	11359	5	Odum	1970
11365	11359	5	Oret	2176
11366	11327	4	Puranga Town Council	6750
11367	11366	5	Ginnery Ward	2503
11368	11366	5	Mission Ward	1433
11369	11366	5	Pida Ward	1631
11370	11366	5	Teobule Ward	1183
11371	11327	4	Te-Nam	6298
11372	11371	5	Aringa	2072
11373	11371	5	Lakoga	935
11374	11371	5	Parwech	1924
11375	11371	5	Tee-Okutu	1367
11376	11326	3	Aruu North County	144038
11377	11376	4	Acholi - Bur Town Council	7748
11378	11377	5	Acumu Ward	3138
11379	11377	5	Gem-Central Ward	2301
11380	11377	5	Kal Ward	2309
11381	11376	4	Acholi-Bur	10895
11382	11381	5	Gem-Onyot	2853
11383	11381	5	Got Okong	2078
11384	11381	5	Ogago	1929
11385	11381	5	Omeda	2169
11386	11381	5	Wii Gweng	1866
11387	11376	4	Ajan	8948
11388	11387	5	Goma	2714
11389	11387	5	Paibwor	2058
11390	11387	5	Pakeyo	2141
11391	11387	5	Wipolo	2035
11392	11376	4	Angagura	13055
11393	11392	5	Bur-Lobo	4301
11394	11392	5	Kalawinya	3145
11395	11392	5	Pucota	2442
11396	11392	5	Pungole	3167
11397	11376	4	Atanga	12518
11398	11397	5	Lawiye Adul	2624
11399	11397	5	Ngoto	4485
11400	11397	5	Opate	5409
11401	11376	4	Atanga Town Council	8607
11402	11401	5	Abora Ward	3018
11403	11401	5	Gojani Ward	2055
11404	11401	5	Kal Ward	2115
11405	11401	5	Labongo Guru Ward	1419
11406	11376	4	Bongtiko	9309
11407	11406	5	Ato	2338
11408	11406	5	Gulalela	1178
11409	11406	5	Ogole	1459
11410	11406	5	Omogi	2207
11411	11406	5	Wanglobo	2127
11412	11376	4	Laguti	8373
11413	11412	5	Kilim	1482
11414	11412	5	Lajeng	2226
11415	11412	5	Lapyem	2039
11416	11412	5	Tumalyec	2626
11417	11376	4	Lapul	9697
11418	11417	5	Alim	2464
11419	11417	5	Koyo	2686
11420	11417	5	Lalogi	2995
11421	11417	5	Lukaci	1552
11422	11376	4	Latanya	7804
11423	11422	5	Amoko	1333
11424	11422	5	Golo	2360
11425	11422	5	Kino	1600
11426	11422	5	Ngekidi	2511
11427	11376	4	Paiula	10891
11428	11427	5	Lamogi	1840
11429	11427	5	Ogago	4441
11430	11427	5	Paiula	2655
11431	11427	5	Palwo	1955
11432	11376	4	Pajule	14547
11433	11432	5	Amoko	2507
11434	11432	5	Oryang	3714
11435	11432	5	Otok	4336
11436	11432	5	Palenga	3990
11437	11376	4	Pajule Town Council	8694
11438	11437	5	Awalmon Ward	1863
11439	11437	5	Gwili Ward	2382
11440	11437	5	Latuturu Ward	2104
11441	11437	5	Pagol Ward	2345
11442	11376	4	Porogali	12952
11443	11442	5	Alima	1882
11444	11442	5	Awee	2507
11445	11442	5	Dure	2174
11446	11442	5	Lamin Nyim	1595
11447	11442	5	Latayi	1805
11448	11442	5	Latigi	2989
11449	3	2	Pakwach	206961
11450	11449	3	Jonam County	206961
11451	11450	4	Alwi	26549
11452	11451	5	Abok	6493
11453	11451	5	Ayila	7974
11454	11451	5	Fualwonga	5252
11455	11451	5	Pangieth	6830
11456	11450	4	Dei	17224
11457	11456	5	Dei	3511
11458	11456	5	Gotrau	1620
11459	11456	5	Hoima	8906
11460	11456	5	Oguta	3187
11461	11450	4	Pakwach	29051
11462	11461	5	Atyak	5341
11463	11461	5	Mukale	10018
11464	11461	5	Olyejo	5660
11465	11461	5	Paroketo	8032
11466	11450	4	Pakwach Town Council	31079
11467	11466	5	Amor East Ward	5348
11468	11466	5	Amor West Ward	7289
11469	11466	5	Puvungu Central Ward	5952
11470	11466	5	Puvungu East Ward	5490
11471	11466	5	Puvungu West Ward	7000
11472	11450	4	Panyango	18840
11473	11472	5	Andibo	2241
11474	11472	5	Pacego	1421
11475	11472	5	Pacer	3413
11476	11472	5	Padoch	3664
11477	11472	5	Pakia	3357
11478	11472	5	Pamitu	2189
11479	11472	5	Pumvuga	2555
11480	11450	4	Panyimur	17952
11481	11480	5	Amoropii	2468
11482	11480	5	Boro	3700
11483	11480	5	Kivuje	4002
11484	11480	5	Lwala	2914
11485	11480	5	Marama	2650
11486	11480	5	Nyakiro	2218
11487	11450	4	Panyimur Town Council	14575
11488	11487	5	Angumu Ward	2393
11489	11487	5	Central Ward	5721
11490	11487	5	Ganda Ward	3505
11491	11487	5	Nyakagei Ward	2956
11492	11450	4	Pokwero	18451
11493	11492	5	Janamorwenyo	2273
11494	11492	5	Lobodegi	3575
11495	11492	5	Oceke	2615
11496	11492	5	Owoi	2239
11497	11492	5	Pokwero	5200
11498	11492	5	Pokwero East	2549
11499	11450	4	Ragem	13975
11500	11499	5	Nyakumba	4873
11501	11499	5	Ragem Lower	2975
11502	11499	5	Ragem Upper	6127
11503	11450	4	Wadelai	19265
11504	11503	5	Mutir	2822
11505	11503	5	Ojigo	3100
11506	11503	5	Ongwelle	4425
11507	11503	5	Pakwinyo	3544
11508	11503	5	Pumit	5374
11509	2	2	Pallisa	334697
11510	11509	3	Agule County	73566
11511	11510	4	Agule	10596
11512	11511	5	Agule	4838
11513	11511	5	Okunguro	5758
11514	11510	4	Agule Town Council	10727
11515	11514	5	Kadodio Ward	2177
11516	11514	5	Morukokume	2385
11517	11514	5	Odusai Ward	2288
11518	11514	5	Pasia Ward	3877
11519	11510	4	Akisim	16045
11520	11519	5	Akisim	4432
11521	11519	5	Kobuin	3761
11522	11519	5	Okisiran	2994
11523	11519	5	Opadoi	4858
11524	11510	4	Chelekura	14481
11525	11524	5	Adodoi	3503
11526	11524	5	Akwamoru	4487
11527	11524	5	Chelekura	3401
11528	11524	5	Kalemen	3090
11529	11510	4	Kameke	12564
11530	11529	5	Kameke	1267
11531	11529	5	Komolo B	2620
11532	11529	5	Komolomanga	1224
11533	11529	5	Kwarikwari	2212
11534	11529	5	Nyakoi	3241
11535	11529	5	Omuroka	2000
11536	11510	4	Oboliso	9153
11537	11536	5	Kateki	1724
11538	11536	5	Kinomu	1400
11539	11536	5	Oboliso	1696
11540	11536	5	Oboliso Komolo	2413
11541	11536	5	Omotoi	1920
11542	11509	3	Gogonyo County	65873
11543	11542	4	Apopong	17244
11544	11543	5	Angololo	2677
11545	11543	5	Apopong	2629
11546	11543	5	Kadumire	3346
11547	11543	5	Kapala	4220
11548	11543	5	Obwanai	4372
11549	11542	4	Gogonyo	20869
11550	11549	5	Ajepet	3768
11551	11549	5	Akuoro	3331
11552	11549	5	Angodi	3480
11553	11549	5	Kachango	3374
11554	11549	5	Okwii	2194
11555	11549	5	Oluwa	2027
11556	11549	5	Oukot	2695
11557	11542	4	Kaukura	15424
11558	11557	5	Adal	2843
11559	11557	5	Aujabule	2865
11560	11557	5	Kakurach	2353
11561	11557	5	Katukei	4549
11562	11557	5	Kaukura	2814
11563	11542	4	Obutet	12336
11564	11563	5	Amoni	2224
11565	11563	5	Gogonyo	1953
11566	11563	5	Obutete	4343
11567	11563	5	Opeta	3816
11568	11509	3	Kibale County	41393
11569	11568	4	Kibale	5207
11570	11569	5	Kibale	5207
11571	11568	4	Kibale Town Council	15743
11572	11571	5	Agurur Ward	1832
11573	11571	5	Apuna Ward	1962
11574	11571	5	Omaulon Ward	1615
11575	11571	5	Omukulai Ward	2124
11576	11571	5	Opogono Ward	2953
11577	11571	5	Otamirio Ward	2978
11578	11571	5	Otelepai Ward	2279
11579	11568	4	Opwateta	20443
11580	11579	5	Kadesok	6018
11581	11579	5	Kapuwai	5754
11582	11579	5	Okaracha	3790
11583	11579	5	Opwateta	4881
11584	11509	3	Pallisa County	153865
11585	11584	4	Boliso	15508
11586	11585	5	Boliso	4549
11587	11585	5	Boliso I	3977
11588	11585	5	Limoto	3653
11589	11585	5	Ogoria	3329
11590	11584	4	Kamuge	12204
11591	11590	5	Boliso II	5778
11592	11590	5	Kagoli	6426
11593	11584	4	Kamuge Town Council	14407
11594	11593	5	Bukaduka Ward	3566
11595	11593	5	Kalapata Ward	1817
11596	11593	5	Kamuge Ward	2272
11597	11593	5	Mpumwire Ward	3290
11598	11593	5	Namugongo Ward	3462
11599	11584	4	Kasodo	17393
11600	11599	5	Kainja	2387
11601	11599	5	Kasodo	3884
11602	11599	5	Nabitende	3083
11603	11599	5	Najeneti	4228
11604	11599	5	Nangodi	3811
11605	11584	4	Olok	19957
11606	11605	5	Apapa	6970
11607	11605	5	Ngalwe	4422
11608	11605	5	Odwarat	4342
11609	11605	5	Olok	4223
11610	11584	4	Pallisa	17835
11611	11610	5	Akadot	7199
11612	11610	5	Kaboloi	5567
11613	11610	5	Kagoli	5069
11614	11584	4	Pallisa Town Council	41108
11615	11614	5	Eastward	5934
11616	11614	5	Hospital Ward	5196
11617	11614	5	Kagwese Ward	11827
11618	11614	5	Kaucho Ward	8884
11619	11614	5	West Ward	9267
11620	11584	4	Puti-Puti	15453
11621	11620	5	Budabula	4519
11622	11620	5	Mpongi	4343
11623	11620	5	Nagule	4256
11624	11620	5	Puti-Puti	2335
11625	1	2	Rakai	346885
11626	11625	3	Buyamba County	171743
11627	11626	4	Ddwaniro	39720
11628	11627	5	Buyamba	7196
11629	11627	5	Ddwaniro	12040
11630	11627	5	Kaleere	6609
11631	11627	5	Kayonza	6417
11632	11627	5	Lwakalolo	7458
11633	11626	4	Kacheera	31293
11634	11633	5	Kajju	7740
11635	11633	5	Kakiri	4358
11636	11633	5	Katatenga	4157
11637	11633	5	Kayonza	5441
11638	11633	5	Lwanga	3049
11639	11633	5	Lyakisana	6548
11640	11626	4	Kagamba	16037
11641	11640	5	Kagamba	5578
11642	11640	5	Lwabakooba	10459
11643	11626	4	Kasankala	16684
11644	11643	5	Kasankala	3841
11645	11643	5	Kirangira	4177
11646	11643	5	Kiyumbakimu	2546
11647	11643	5	Kongota	3706
11648	11643	5	Kyamakanaga	2414
11649	11626	4	Lwamaggwa	46418
11650	11649	5	Bugona	13327
11651	11649	5	Kabusotta	5665
11652	11649	5	Kakundi	4312
11653	11649	5	Kibuuka	11272
11654	11649	5	Kyabigondo	11842
11655	11626	4	Lwamaggwa Town Council	12375
11656	11655	5	Kakabagyo Ward	4229
11657	11655	5	Kakundi Ward	3694
11658	11655	5	Kiweeka Ward	1328
11659	11655	5	Lubimba Ward	1538
11660	11655	5	Lwamaggwa Ward	1586
11661	11626	4	Lwentulege Town Council	9216
11662	11661	5	Kimuli Ward	1977
11663	11661	5	Kituntu Ward	1492
11664	11661	5	Lwentulege Ward	3280
11665	11661	5	Mweruka Ward	2467
11666	11625	3	Kooki County	175142
11667	11666	4	Byakabanda	20956
11668	11667	5	Byakabanda	7297
11669	11667	5	Kamukalo	10387
11670	11667	5	Kitaasa	3272
11671	11666	4	Dyango Town Council	12448
11672	11671	5	Dyango Ward	4116
11673	11671	5	Kikarabo Ward	2043
11674	11671	5	Kisovu Ward	3440
11675	11671	5	Rwambajjo Ward	2849
11676	11666	4	Kibaale Town Council	12104
11677	11676	5	Kabigo Ward	2909
11678	11676	5	Kalungi Ward	2512
11679	11676	5	Kibaale Ward	4686
11680	11676	5	Kigumba Ward	1997
11681	11666	4	Kibanda	20902
11682	11681	5	Bbale	4549
11683	11681	5	Kakinga	10132
11684	11681	5	Kyalugaba	6221
11685	11666	4	Kifamba	16338
11686	11685	5	Kabala	4149
11687	11685	5	Kawunguli	4103
11688	11685	5	Kifamba	4033
11689	11685	5	Kisaasa	4053
11690	11666	4	Kiziba	9014
11691	11690	5	Lukerere	6117
11692	11690	5	Ndagga	2897
11693	11666	4	Kiziba Town Council	8728
11694	11693	5	Kijonjo	2242
11695	11693	5	Rwakakara	2688
11696	11693	5	Rweibara	2287
11697	11693	5	Rwensinga	1511
11698	11666	4	Kyalulangira	12125
11699	11698	5	Kasula	9530
11700	11698	5	Kizinga	2595
11701	11666	4	Lwanda	34475
11702	11701	5	Bitabago	6286
11703	11701	5	Butiiti	6944
11704	11701	5	Kanoni	4122
11705	11701	5	Kasensero	8117
11706	11701	5	Kiyovu	9006
11707	11666	4	Mweruka Town Council	8770
11708	11707	5	Kalwayi Ward	2037
11709	11707	5	Magabirana Ward	2091
11710	11707	5	Mweruka Ward	2935
11711	11707	5	Nyanja Ward	1707
11712	11666	4	Ntantamuki Town Council	11004
11713	11712	5	Kamuli Ward	2510
11714	11712	5	Kibuliro Ward	2482
11715	11712	5	Mugabi Ward	3289
11716	11712	5	Ntantamuki Ward	2723
11717	11666	4	Rakai Town Council	8278
11718	11717	5	Katuntu Ward	3223
11719	11717	5	Kibona Ward	5055
11720	4	2	Rubanda	249454
11721	11720	3	Rubanda County	249454
11722	11721	4	Bubaare Town Council	18956
11723	11722	5	Bubare	3630
11724	11722	5	Kitojo Ward	5672
11725	11722	5	Muyanje	4562
11726	11722	5	Nyamiyaga	5092
11727	11721	4	Bubare	10941
11728	11727	5	Ihanga	3549
11729	11727	5	Kashenyi	4615
11730	11727	5	Kibuzigye	2777
11731	11721	4	Bufundi	9619
11732	11731	5	Kagunga	4650
11733	11731	5	Kishanje	4969
11734	11721	4	Butare-Katojo Town Council	9330
11735	11734	5	Bishaki Ward	1870
11736	11734	5	Hamutoora Ward	1996
11737	11734	5	Ntungamo-Byeza Ward	2677
11738	11734	5	Rurembo Ward	2787
11739	11721	4	Habuhutu Town Council	7169
11740	11739	5	Butusi Ward	2562
11741	11739	5	Kitabugika Ward	1995
11742	11739	5	Muruhinga Ward	2612
11743	11721	4	Hamuhambo Town Council	13176
11744	11743	5	Bunyonyi View Ward	3169
11745	11743	5	Bushuura Ward	4736
11746	11743	5	Kagarama Ward	3375
11747	11743	5	Kibuzigye Ward	1896
11748	11721	4	Hamurwa	33507
11749	11748	5	Igomanda	7663
11750	11748	5	Kakore	6335
11751	11748	5	Mpungu	7359
11752	11748	5	Ruhonwa	5341
11753	11748	5	Shebeya	6809
11754	11721	4	Hamurwa Town Council	6448
11755	11754	5	Hamurwa	1764
11756	11754	5	Kanyabitara	2231
11757	11754	5	Karukara	1295
11758	11754	5	Nangaro	1158
11759	11721	4	Ikumba	21817
11760	11759	5	Kashasha	8089
11761	11759	5	Mushanje	5433
11762	11759	5	Nyamabare	5275
11763	11759	5	Nyaruhanga	3020
11764	11721	4	Kacerere Town Council	7281
11765	11764	5	Kacerere Ward	1719
11766	11764	5	Kiruruma Ward	1679
11767	11764	5	Nyamatembe	2426
11768	11764	5	Nyarushija Ward	1457
11769	11721	4	Kashasha Town Council	7531
11770	11769	5	Kitooma Ward	2006
11771	11769	5	Murandamo Ward	3840
11772	11769	5	Nyakabungo Ward	1685
11773	11721	4	Muko	40536
11774	11773	5	Butare	4086
11775	11773	5	Ikamiro	7462
11776	11773	5	Kaara	5794
11777	11773	5	Kabere	4755
11778	11773	5	Karengyere	5926
11779	11773	5	Kyenyi	5471
11780	11773	5	Nyarurambi	7042
11781	11721	4	Nshanjare Town Council	8213
11782	11781	5	Bwegyerera Ward	1611
11783	11781	5	Ihunga Ward	1610
11784	11781	5	Kivunga Ward	1440
11785	11781	5	Mengo Ward	2093
11786	11781	5	Nshanjare Ward	1459
11787	11721	4	Nyamweeru	21134
11788	11787	5	Bigungiro	3176
11789	11787	5	Bwayu	3712
11790	11787	5	Kaceenaga	3279
11791	11787	5	Kyokyezo	3350
11792	11787	5	Nangara	4596
11793	11787	5	Nyamweru	3021
11794	11721	4	Rubanda Town Council	20687
11795	11794	5	Kigyeyo Ward	4228
11796	11794	5	Nyakabungo Ward	5088
11797	11794	5	Nyaruhanga Ward	5346
11798	11794	5	Nyarurambi Ward	6025
11799	11721	4	Ruhija	6880
11800	11799	5	Buhumuriro	421
11801	11799	5	Kashekyera	283
11802	11799	5	Kitojo	987
11803	11799	5	Kiyebe	2994
11804	11799	5	Ntungamo	2195
11805	11721	4	Ruhija Town Council	6229
11806	11805	5	Buhumuriro Ward	1618
11807	11805	5	Kashekyera Ward	2039
11808	11805	5	Kitojo Ward	2572
11809	4	2	Rubirizi	168211
11810	11809	3	Bunyaruguru County	85512
11811	11810	4	Katunguru	4141
11812	11811	5	Kashaka	1173
11813	11811	5	Katunguru	804
11814	11811	5	Kazinga	965
11815	11811	5	Kishenyi	1199
11816	11810	4	Kichwamba	20574
11817	11816	5	Kataara	3534
11818	11816	5	Kichwamba	3895
11819	11816	5	Kyambura	3723
11820	11816	5	Nyakasozi	2838
11821	11816	5	Rumuri	6584
11822	11810	4	Magambo	15521
11823	11822	5	Bugaya	3699
11824	11822	5	Butoha	6370
11825	11822	5	Magambo	2434
11826	11822	5	Rubirizi	1527
11827	11822	5	Rugazi	1491
11828	11810	4	Rubirizi Town Council	11042
11829	11828	5	Kabete Ward	2663
11830	11828	5	Kasarara Ward	2447
11831	11828	5	Ndekye Ward	2599
11832	11828	5	Nyakasharu	3333
11833	11810	4	Rutoto	17640
11834	11833	5	Bururuma	3448
11835	11833	5	Kashenyi	3115
11836	11833	5	Ndangaro	4166
11837	11833	5	Nyabubare	3143
11838	11833	5	Rwemitagu	3768
11839	11810	4	Ryeru	16594
11840	11839	5	Buzenga	3056
11841	11839	5	Mubanda	2534
11842	11839	5	Mugogo	1377
11843	11839	5	Mushumba	3089
11844	11839	5	Ndangara	2901
11845	11839	5	Ndekye	1144
11846	11839	5	Nyakiyanja	2493
11847	11809	3	Katerera County	82699
11848	11847	4	Katanda	24614
11849	11848	5	Katanda	5478
11850	11848	5	Kyankaranga	4121
11851	11848	5	Mugyera	3790
11852	11848	5	Munyonyi	4478
11853	11848	5	Nyandongo	2939
11854	11848	5	Ryamatumba	3808
11855	11847	4	Katerera	15447
11856	11855	5	Katerera	4029
11857	11855	5	Mwongyera	5207
11858	11855	5	Nyamabare	4038
11859	11855	5	Nyamirima	2173
11860	11847	4	Katerera Town Council	11574
11861	11860	5	Kacu Ward	1716
11862	11860	5	Katerera Ward	3674
11863	11860	5	Muyenga Ward	2232
11864	11860	5	Nyakagyezi Ward	3952
11865	11847	4	Kirugu	13454
11866	11865	5	Kikumbo	5359
11867	11865	5	Kirugu	2177
11868	11865	5	Kyenzaza	3860
11869	11865	5	Mirarikye	2058
11870	11847	4	Kyabakara	17610
11871	11870	5	Kakaari	4506
11872	11870	5	Kyabakara	3065
11873	11870	5	Ngoro	3176
11874	11870	5	Nyabubare	4136
11875	11870	5	Rugarama	2727
11876	4	2	Rukiga	132355
11877	11876	3	Rukiga County	132355
11878	11877	4	Bukinda	12832
11879	11878	5	Kandago	2507
11880	11878	5	Karorwa	3046
11881	11878	5	Kyerero	4747
11882	11878	5	Nyakasiru	2532
11883	11877	4	Kamwezi	37850
11884	11883	5	Kashekye	8482
11885	11883	5	Kibanda	10859
11886	11883	5	Kigara	7052
11887	11883	5	Kyabuhangwa	4918
11888	11883	5	Kyogo	3555
11889	11883	5	Rwenyangye	2984
11890	11877	4	Kashambya	32074
11891	11890	5	Buchundura	5815
11892	11890	5	Kafunjo	4812
11893	11890	5	Kitanga	9098
11894	11890	5	Kitunga	2497
11895	11890	5	Nyakashebeya	3975
11896	11890	5	Rutengye	5877
11897	11877	4	Mparo Town Council	5237
11898	11897	5	Central Ward	1645
11899	11897	5	Kangondo Ward	1136
11900	11897	5	Sindi Ward	2456
11901	11877	4	Muhanga Town Council	16422
11902	11901	5	Butare Ward	3824
11903	11901	5	Highland Ward	2639
11904	11901	5	Muhanga Ward	4567
11905	11901	5	Nyakabungo Ward	3352
11906	11901	5	Rutare Ward	2040
11907	11877	4	Rwamucucu	27940
11908	11907	5	Burime	3456
11909	11907	5	Ibumba	4863
11910	11907	5	Kitojo	6271
11911	11907	5	Noozi	5388
11912	11907	5	Nyakagabagaba	4304
11913	11907	5	Nyarurambi	3658
11914	4	2	Rukungiri	376110
11915	11914	3	Rubabo County	169250
11916	11915	4	Buyanja	39227
11917	11916	5	Bugyera	4452
11918	11916	5	Kasheeshe	3003
11919	11916	5	Kyamakanda	4484
11920	11916	5	Nyabiteete	4352
11921	11916	5	Nyakabungo	3678
11922	11916	5	Nyakaina	5448
11923	11916	5	Rubanga North	4057
11924	11916	5	Rubanga South	6151
11925	11916	5	Rwakirungura	3602
11926	11915	4	Buyanja Town Council	5974
11927	11926	5	Katojo Ward	2040
11928	11926	5	Kyamakanda Ward	1355
11929	11926	5	Nyakaina Ward	2579
11930	11915	4	Kebisoni	15663
11931	11930	5	Garubunda	1531
11932	11930	5	Karuhembe	4166
11933	11930	5	Kiigiro	1520
11934	11930	5	Mabanga	3905
11935	11930	5	Nyeibingo	4541
11936	11915	4	Kebisoni Town Council	16811
11937	11936	5	Central Ward	6126
11938	11936	5	Eastern Ward	4396
11939	11936	5	Northern Ward	3193
11940	11936	5	Southern Ward	3096
11941	11915	4	Nyakishenyi	40083
11942	11941	5	Bikongozo	2284
11943	11941	5	Kacence	4998
11944	11941	5	Kafunjo	2058
11945	11941	5	Kahoko	3163
11946	11941	5	Katonya	3234
11947	11941	5	Kibale	5049
11948	11941	5	Kilimbe	3210
11949	11941	5	Kisya	4517
11950	11941	5	Murama	5412
11951	11941	5	Ngoma	2531
11952	11941	5	Nyarugando	1443
11953	11941	5	Rwanyundo	2184
11954	11915	4	Nyarushanje	51492
11955	11954	5	Bunono	4270
11956	11954	5	Burora	4423
11957	11954	5	Bwanga	5272
11958	11954	5	Ibanda	5743
11959	11954	5	Ihunga	3459
11960	11954	5	Kabuga	1905
11961	11954	5	Kayanga	5093
11962	11954	5	Kiganga	2463
11963	11954	5	Kisiizi	4548
11964	11954	5	Ndago	2490
11965	11954	5	Nyabushenyi	4279
11966	11954	5	Nyakatunga	3407
11967	11954	5	Ruyonza	4140
11968	11914	3	Rujumbura County	163331
11969	11968	4	Bikurungu Town Council	6147
11970	11969	5	Central Ward	2239
11971	11969	5	Eastern Ward	1559
11972	11969	5	Nyamitooma Ward	768
11973	11969	5	Western Ward	1581
11974	11968	4	Bugangari	34840
11975	11974	5	Bugangari	6716
11976	11974	5	Burama	4354
11977	11974	5	Kakindo	3251
11978	11974	5	Kanyankyende	2721
11979	11974	5	Kashayo	5557
11980	11974	5	Katerampungu	2403
11981	11974	5	Kazindiro	4614
11982	11974	5	Kyabureere	2818
11983	11974	5	Nyabiteete	2406
11984	11968	4	Buhunga	23379
11985	11984	5	Buhunga	3499
11986	11984	5	Bwanda	4050
11987	11984	5	Kabingo	3595
11988	11984	5	Kibirizi	3330
11989	11984	5	Kihanga	2866
11990	11984	5	Kyaruyenje	3673
11991	11984	5	Rusheshe	2366
11992	11968	4	Bwambara	32143
11993	11992	5	Bwambara	5311
11994	11992	5	Garuka	4204
11995	11992	5	Kakoni	3023
11996	11992	5	Kikarara	3978
11997	11992	5	Kikongi	6763
11998	11992	5	Kyabahanga	4077
11999	11992	5	Nyabubare	3268
12000	11992	5	Rwenshama	1519
12001	11968	4	Nyakagyeme	33961
12002	12001	5	Kabwoma	3806
12003	12001	5	Kahoko	3617
12004	12001	5	Katooma	2089
12005	12001	5	Kigaaga	4302
12006	12001	5	Kinyamahwa	5021
12007	12001	5	Kitimba	2675
12008	12001	5	Masya	6163
12009	12001	5	Nyakinengo	3489
12010	12001	5	Rushasha	2799
12011	11968	4	Ruhinda	28096
12012	12011	5	Burombe	5386
12013	12011	5	Kicwamba	5089
12014	12011	5	Ndere	5293
12015	12011	5	Nyakitabire	2761
12016	12011	5	Nyakitabire B	2609
12017	12011	5	Nyarwimuka	4496
12018	12011	5	Rwamugoma	2462
12019	11968	4	Rwerere Town Council	4765
12020	12019	5	Bigaga Ward	1460
12021	12019	5	Kagugu Ward	1740
12022	12019	5	Rusoroza Ward	1565
12023	11914	3	Rukungiri Municipality	43529
12024	12023	4	Eastern Division	14841
12025	12024	5	Kagashe Ward	2158
12026	12024	5	Kyatoko Ward	5559
12027	12024	5	Northern B Ward	1837
12028	12024	5	Rwentondo Ward	5287
12029	12023	4	Southern Division	12106
12030	12029	5	Kanyinya Ward	2943
12031	12029	5	Kigaaga	1627
12032	12029	5	Ndorero Ward	2759
12033	12029	5	Rwakabengo Ward	4777
12034	12023	4	Western Division	16582
12035	12034	5	Karangaro Ward	4907
12036	12034	5	Kinyasano Ward	3441
12037	12034	5	Kitimba Ward	3024
12038	12034	5	Northern A Ward	5210
12039	4	2	Rwampara	162967
12040	12039	3	Rwampara County	72792
12041	12040	4	Buteraniro-Nyeihanga Town Council	17898
12042	12041	5	Bujaga Ward	5184
12043	12041	5	Kakigani Ward	5265
12044	12041	5	Nyeihanga Ward	7449
12045	12040	4	Kinoni Town Council	16502
12046	12045	5	Katereza Ward	3049
12047	12045	5	Kinoni Central Ward	3667
12048	12045	5	Kitunguru Ward	5152
12049	12045	5	Nyarubungo Ward	4634
12050	12040	4	Ndeija	23593
12051	12050	5	Kibare	6295
12052	12050	5	Kongoro	3953
12053	12050	5	Ndeija-Mulago	4101
12054	12050	5	Nyakaikara	5860
12055	12050	5	Rwensinga	3384
12056	12040	4	Rugando	14799
12057	12056	5	Mirama	3942
12058	12056	5	Nyabikungu	6629
12059	12056	5	Nyakabaare	4228
12060	12039	3	Rwampara East County	90175
12061	12060	4	Bugamba	31896
12062	12061	5	Kabarama	7801
12063	12061	5	Kamomo	3964
12064	12061	5	Kitojo	4286
12065	12061	5	Ngugo	7151
12066	12061	5	Nyaruhandagazi	8694
12067	12060	4	Kabura Town Council	12100
12068	12067	5	Kikonkoma Ward	2789
12069	12067	5	Mwizi Ward	6525
12070	12067	5	Ngoma Ward	2786
12071	12060	4	Mwizi	33286
12072	12071	5	Bushwere	12064
12073	12071	5	Kigaaga	7452
12074	12071	5	Rukarabo	5953
12075	12071	5	Ryamiyonga	7817
12076	12060	4	Rweibogo-Kibingo Town Council	12893
12077	12076	5	Kibingo Ward	6349
12078	12076	5	Rweibogo Ward	6544
12079	2	2	Serere	358123
12080	12079	3	Kasilo County	91721
12081	12080	4	Bugondo	44471
12082	12081	5	Agule	9913
12083	12081	5	Bugondo	5906
12084	12081	5	Kamod	7248
12085	12081	5	Kongoto	7659
12086	12081	5	Ogera	6070
12087	12081	5	Toror	7675
12088	12080	4	Kadungulu	21523
12089	12088	5	Iruko	11597
12090	12088	5	Kabulabula	9926
12091	12080	4	Kadungulu Town Council	14495
12092	12091	5	Adukut Ward	3113
12093	12091	5	Adwenyi Ward	3523
12094	12091	5	Kadungulu Central Ward	4168
12095	12091	5	Kateng Ward	3691
12096	12080	4	Kagwara Town Council	6407
12097	12096	5	Akwangalet Ward	1868
12098	12096	5	Amoru Ward	1722
12099	12096	5	Kachorombo Ward	1108
12100	12096	5	Kagwara Central Ward	1709
12101	12080	4	Kasilo Town Council	4825
12102	12101	5	Kamod Ward	1465
12103	12101	5	Kasilo Ward	1460
12104	12101	5	Kololo Ward	1900
12105	12079	3	Pingire County	68627
12106	12105	4	Kidetok Town Council	14899
12107	12106	5	Agonyo I Ward	2576
12108	12106	5	Agonyo II Ward	1841
12109	12106	5	Central Ward	2567
12110	12106	5	Kidetok Ward	3210
12111	12106	5	Okolonga Ward	3170
12112	12106	5	Omolotok Ward	1535
12113	12105	4	Labor	26056
12114	12113	5	Aarapoo	8378
12115	12113	5	Aswii	5533
12116	12113	5	Labor	12145
12117	12105	4	Pingire	27672
12118	12117	5	Akumoi	4094
12119	12117	5	Odapakol	3691
12120	12117	5	Okidi	10166
12121	12117	5	Pingire	9721
12122	12079	3	Serere County	197775
12123	12122	4	Atiira	25480
12124	12123	5	Alengo	6788
12125	12123	5	Asilang	5832
12126	12123	5	Atiira	6057
12127	12123	5	Opuure	6803
12128	12122	4	Kateta	60476
12129	12128	5	Kamusala	6585
12130	12128	5	Kanyangan	9636
12131	12128	5	Kateta	12914
12132	12128	5	Ojetenyang	7329
12133	12128	5	Okodo	6620
12134	12128	5	Omagara	8177
12135	12128	5	Orupe	1955
12136	12128	5	Owiny-Agule	7260
12137	12122	4	Kyere	47098
12138	12137	5	Abuket	7710
12139	12137	5	Kakuja	4224
12140	12137	5	Kamurojo	7598
12141	12137	5	Kangodo	3329
12142	12137	5	Kelim	7885
12143	12137	5	Kyere	1565
12144	12137	5	Olupe	8007
12145	12137	5	Omagoro	6780
12146	12122	4	Kyere Town Council	7615
12147	12146	5	Akisim Ward	2619
12148	12146	5	Kakuja Ward	2622
12149	12146	5	Kyere Central Ward	930
12150	12146	5	Omorio Ward	1444
12151	12122	4	Ocaapa Town Council	10515
12152	12151	5	Kangodo Ward	2565
12153	12151	5	Obuiekori Ward	1767
12154	12151	5	Oburin Ward	1597
12155	12151	5	Ocaapa Central Ward	1974
12156	12151	5	Orupe Ward	2612
12157	12122	4	Olio	35791
12158	12157	5	Akoboi	7138
12159	12157	5	Kakus	4831
12160	12157	5	Oburin	5561
12161	12157	5	Odungura	6246
12162	12157	5	Okulonyo	5060
12163	12157	5	Osuguro	6955
12164	12122	4	Serere Town Council	10800
12165	12164	5	Kakus Ward	4487
12166	12164	5	Okulonyo Ward	592
12167	12164	5	Osuguro Ward	5721
12168	4	2	Sheema	252275
12169	12168	3	Sheema County	153681
12170	12169	4	Bugongi Town Council	13480
12171	12170	5	Isingiro Ward	3459
12172	12170	5	Kyamurari North Ward	3805
12173	12170	5	Kyamurari South Ward	2715
12174	12170	5	Kyarukunda Ward	3501
12175	12169	4	Kakindo Town Council	12372
12176	12175	5	Kyangundu Ward	3593
12177	12175	5	Kyangyenyi Ward	3347
12178	12175	5	Rweibare Ward	2641
12179	12175	5	Ryenjoki Ward	2791
12180	12169	4	Kasaana	15110
12181	12180	5	Karugorora	1771
12182	12180	5	Kasaana Central	3530
12183	12180	5	Kasaana East	2929
12184	12180	5	Kasaana North	1101
12185	12180	5	Kasaana West	2037
12186	12180	5	Kyeihara	1825
12187	12180	5	Rukondo	1917
12188	12169	4	Kigarama	21927
12189	12188	5	Bwayegamba	6422
12190	12188	5	Katooma	2462
12191	12188	5	Kigarama	4870
12192	12188	5	Kyengando	3435
12193	12188	5	Runyinya	4738
12194	12169	4	Kitagata	11599
12195	12194	5	Kashekuro	4907
12196	12194	5	Kyeibanga East	3248
12197	12194	5	Kyeibanga West	3444
12198	12169	4	Kitagata Town Council	16151
12199	12198	5	Buraro Ward	2587
12200	12198	5	Kyarushakara Ward	3208
12201	12198	5	Marembo Ward	3501
12202	12198	5	Muhito North Ward	2047
12203	12198	5	Muhito South Ward	2165
12204	12198	5	Rutoma Ward	2643
12205	12169	4	Kyangyenyi	11291
12206	12205	5	Kagongi	3882
12207	12205	5	Kashanjure	1887
12208	12205	5	Masyoro	2571
12209	12205	5	Muzira	2951
12210	12169	4	Masheruka	8269
12211	12210	5	Katojo	1718
12212	12210	5	Kyabuharambo	2109
12213	12210	5	Nyabwina	2518
12214	12210	5	Rugazi	1924
12215	12169	4	Masheruka Town Council	16608
12216	12215	5	Buringo Ward	2752
12217	12215	5	Kabutsye Ward	4295
12218	12215	5	Kanyeganyegye Ward	3086
12219	12215	5	Mabare Ward	3492
12220	12215	5	Nyakambu Ward	2983
12221	12169	4	Rugarama	9663
12222	12221	5	Nyakarama North	1280
12223	12221	5	Nyakarama South	2660
12224	12221	5	Nyakashoga	1869
12225	12221	5	Rugarama	3854
12226	12169	4	Shuuku Town Council	17211
12227	12226	5	Kishabya Ward	4919
12228	12226	5	Kyempitsi East Ward	3397
12229	12226	5	Kyempitsi West Ward	2610
12230	12226	5	Rwabuza Ward	4025
12231	12226	5	Ryakasinga Ward	2260
12232	12168	3	Sheema Municipality	98594
12233	12232	4	Kabwohe Division	26209
12234	12233	5	Kabwohe Ward	3702
12235	12233	5	Kakunyu Ward	4204
12236	12233	5	Kyagaju Ward	2055
12237	12233	5	Nyanga Ward	5442
12238	12233	5	Rushozi Ward	7189
12239	12233	5	Rutooma Ward	3617
12240	12232	4	Kagango Division	30469
12241	12240	5	Itendero Ward	2576
12242	12240	5	Kanyinasheema Ward	2399
12243	12240	5	Kihunda Ward	7668
12244	12240	5	Kiziba Ward	7616
12245	12240	5	Migina Ward	6262
12246	12240	5	Ndeebo Ward	1520
12247	12240	5	Rwenshama Ward	2428
12248	12232	4	Kashozi Division	17415
12249	12248	5	Karera North Ward	4078
12250	12248	5	Karera South	3418
12251	12248	5	Kashozi Central Ward	2931
12252	12248	5	Kashozi East Ward	3902
12253	12248	5	Kashozi West Ward	3086
12254	12232	4	Sheema Central Division	24501
12255	12254	5	Kitojo Ward	5782
12256	12254	5	Kyabandara Ward	5786
12257	12254	5	Nyakashambya Ward	2554
12258	12254	5	Nyarweshama Ward	5658
12259	12254	5	Rwamujojo Ward	4721
12260	2	2	Sironko	298363
12261	12260	3	Budadiri County	298363
12262	12261	4	Bubbeza	4203
12263	12262	5	Bubbeza	804
12264	12262	5	Bumugembe	1122
12265	12262	5	Bunabuka	1098
12266	12262	5	Buwakooli	685
12267	12262	5	Lyamusabasi	494
12268	12261	4	Budadiri Town Council	12846
12269	12268	5	Bugiwumi Ward	2209
12270	12268	5	Bunyode Ward	3690
12271	12268	5	Kalawa Ward	3098
12272	12268	5	Nakiwondwe Ward	3849
12273	12261	4	Bugambi	4736
12274	12273	5	Bugambi	1660
12275	12273	5	Bulome	1451
12276	12273	5	Bumalunda	1625
12277	12261	4	Bugitimwa	5110
12278	12277	5	Bumagabula	901
12279	12277	5	Bumulegi	858
12280	12277	5	Elgon	1268
12281	12277	5	Kisali	447
12282	12277	5	Lusagali	1636
12283	12261	4	Bugusege Town Council	4449
12284	12283	5	Bugusege Ward	1126
12285	12283	5	Bukimali Ward	1179
12286	12283	5	Kakodye Ward	694
12287	12283	5	Kitoko Ward	1450
12288	12261	4	Buhugu	4132
12289	12288	5	Budindi	563
12290	12288	5	Bukitemu	625
12291	12288	5	Bumatofu	1464
12292	12288	5	Kibolo	994
12293	12288	5	Miwu	486
12294	12261	4	Bukhulo	17915
12295	12294	5	Bubetsye	2100
12296	12294	5	Bukhulo	1293
12297	12294	5	Kirombe	3001
12298	12294	5	Mpogo	2790
12299	12294	5	Sironko	2522
12300	12294	5	Soola	3358
12301	12294	5	Walanga	2851
12302	12261	4	Bukiise	22195
12303	12302	5	Bukiise	2833
12304	12302	5	Bukirindya	1864
12305	12302	5	Busate	3997
12306	12302	5	Busiu	2385
12307	12302	5	Kilulu	2710
12308	12302	5	Nalugugu	2628
12309	12302	5	Nandago	5778
12310	12261	4	Bukiiti Town Council	3603
12311	12310	5	Bukiiti A Ward	867
12312	12310	5	Bukiiti B Ward	855
12313	12310	5	Bumadibira Ward	1220
12314	12310	5	Butandiga Ward	661
12315	12261	4	Bukiyi	8035
12316	12315	5	Bukigalabo	1502
12317	12315	5	Bumahaga	885
12318	12315	5	Kalasa	647
12319	12315	5	Kiwagalo	979
12320	12315	5	Nabenekwa	1211
12321	12315	5	Namengo	1418
12322	12315	5	Nampanga	1393
12323	12261	4	Bukyabo	7707
12324	12323	5	Bukyabo	1697
12325	12323	5	Bumusabire	735
12326	12323	5	Busahe	1007
12327	12323	5	Buwobudeya	707
12328	12323	5	Gombe	1432
12329	12323	5	Kyambogo	1200
12330	12323	5	Zebigi	929
12331	12261	4	Bukyambi	4275
12332	12331	5	Bukama	1333
12333	12331	5	Bukyambi	1263
12334	12331	5	Bumba	864
12335	12331	5	Bunandudu	815
12336	12261	4	Bumalimba	5657
12337	12336	5	Bumalimba	1506
12338	12336	5	Bumudoma	1827
12339	12336	5	Musene	647
12340	12336	5	Nambalenze	1246
12341	12336	5	Namulanda	431
12342	12261	4	Bumasifwa	5642
12343	12342	5	Bufaka	1263
12344	12342	5	Bulwala	1528
12345	12342	5	Bunamahande	970
12346	12342	5	Bundagala	1253
12347	12342	5	Masagala	628
12348	12261	4	Bumulisha	5290
12349	12348	5	Bumaludye	685
12350	12348	5	Bumulisha	1851
12351	12348	5	Buwagama	773
12352	12348	5	Kigunyunyu	505
12353	12348	5	Madodo	935
12354	12348	5	Nakidowa	541
12355	12261	4	Bunyafwa	5219
12356	12355	5	Bugalabi	853
12357	12355	5	Bunandalo	1459
12358	12355	5	Bunazami	774
12359	12355	5	Buwila	784
12360	12355	5	Kigulya	465
12361	12355	5	Magga	884
12362	12261	4	Busamaga	4110
12363	12362	5	Bugusege	1409
12364	12362	5	Bukidiya	646
12365	12362	5	Bunazomi	876
12366	12362	5	Busamaga	469
12367	12362	5	Buwamaniala	710
12368	12261	4	Busiita	5305
12369	12368	5	Bugibugi	1021
12370	12368	5	Bugwa	600
12371	12368	5	Bumadyemu	1041
12372	12368	5	Bumugwedi	1056
12373	12368	5	Busiita	789
12374	12368	5	Kirali	798
12375	12261	4	Busulani	8283
12376	12375	5	Bugimunye	1077
12377	12375	5	Bugube	1115
12378	12375	5	Buluzwala	774
12379	12375	5	Bumawosa	1205
12380	12375	5	Bunagawoya	1161
12381	12375	5	Bunakirima	1388
12382	12375	5	Namwejje	1563
12383	12261	4	Butandiga	2542
12384	12383	5	Bunamahe	613
12385	12383	5	Jewa	568
12386	12383	5	Mbata	679
12387	12383	5	Sigwa	682
12388	12261	4	Butandiga Town Council	2625
12389	12388	5	Bunabususu Ward	335
12390	12388	5	Busoliti Ward	501
12391	12388	5	Gibutere Ward	756
12392	12388	5	Kilindi Ward	420
12393	12388	5	Lwanda Ward	307
12394	12388	5	Mbaya Ward	306
12395	12261	4	Buteza	5396
12396	12395	5	Bugidyonyi	3146
12397	12395	5	Bukwanga	1102
12398	12395	5	Bumukone	1148
12399	12261	4	Buteza Town Council	4217
12400	12399	5	Bubalinganga Ward	1591
12401	12399	5	Bugwimbi Ward	538
12402	12399	5	Bukisimamu Ward	865
12403	12399	5	Nangoko Ward	1223
12404	12261	4	Buwalasi	6217
12405	12404	5	Bumudu	1372
12406	12404	5	Buwira	802
12407	12404	5	Nadiso	1993
12408	12404	5	Nagudi	798
12409	12404	5	Sinasi	715
12410	12404	5	Sugi	537
12411	12261	4	Buwasa	5931
12412	12411	5	Bugwagi	1909
12413	12411	5	Bukimali	1370
12414	12411	5	Bumasaba	1127
12415	12411	5	Bunagami	1525
12416	12261	4	Buweri Town Council	5813
12417	12416	5	Bumasajje Ward	1191
12418	12416	5	Bumwambu Ward	1106
12419	12416	5	Busedani Ward	1137
12420	12416	5	Buwangolo Ward	927
12421	12416	5	Buweri Ward	1452
12422	12261	4	Buyobo	11545
12423	12422	5	Bukimenya	1995
12424	12422	5	Bulambuli	2081
12425	12422	5	Bumayamba	2123
12426	12422	5	Bumusi	2307
12427	12422	5	Buyoola	3039
12428	12261	4	Dahami	9081
12429	12428	5	Bugwagi	952
12430	12428	5	Bukiyi	1027
12431	12428	5	Bumejji	549
12432	12428	5	Bumiliyu	839
12433	12428	5	Dahami	971
12434	12428	5	Kaduwa	1471
12435	12428	5	Katulu	1010
12436	12428	5	Nabudisiru	2262
12437	12261	4	Elgon	2753
12438	12437	5	Butandiga	932
12439	12437	5	Kikolo	416
12440	12437	5	Nakitali	793
12441	12437	5	Namasiya	612
12442	12261	4	Gombe Gasawa Town Council	5484
12443	12442	5	Bugiboni Ward	1843
12444	12442	5	Buwetye Ward	1120
12445	12442	5	Gombe Ward	2005
12446	12442	5	Kisali Ward	516
12447	12261	4	Kama Town Council	2455
12448	12447	5	Kama A Ward	762
12449	12447	5	Kama B Ward	565
12450	12447	5	Kama C Ward	541
12451	12447	5	Magulu Ward	587
12452	12261	4	Kikobero	6473
12453	12452	5	Gibinda	691
12454	12452	5	Kikobero	2146
12455	12452	5	Namwenje	524
12456	12452	5	Ngwele	575
12457	12452	5	Simu/pondo	2537
12458	12261	4	Legenya	6367
12459	12458	5	Bumaguze	350
12460	12458	5	Bumasifwa	1094
12461	12458	5	Bumasobo	1251
12462	12458	5	Bumuhune	1640
12463	12458	5	Bunagami	310
12464	12458	5	Bunamudulo	360
12465	12458	5	Buwodero	374
12466	12458	5	Gabende	466
12467	12458	5	Gibumbuni	522
12468	12261	4	Lulena	6738
12469	12468	5	Bukumbale	695
12470	12468	5	Bumanganga	694
12471	12468	5	Buyaya	519
12472	12468	5	Kibembe	1960
12473	12468	5	Lulena	690
12474	12468	5	Luseke	988
12475	12468	5	Nalusala	669
12476	12468	5	Wakine	523
12477	12261	4	Mafudu	6979
12478	12477	5	Bunashimolo	1534
12479	12477	5	Bundege	1572
12480	12477	5	Bungwanyi	1498
12481	12477	5	Mafudu	2375
12482	12261	4	Masaba	12850
12483	12482	5	Buboolo	2581
12484	12482	5	Bufupa	1836
12485	12482	5	Bukinyale	3434
12486	12482	5	Bumuluwe	1225
12487	12482	5	Zesui	3774
12488	12261	4	Mutufu Town Council	10777
12489	12488	5	Bunandasa Ward	1153
12490	12488	5	Central Ward	2623
12491	12488	5	Eastern Ward	820
12492	12488	5	Kisenyi Ward	975
12493	12488	5	Masabasi Ward	1172
12494	12488	5	Nandere Ward	1027
12495	12488	5	Southern Ward	1536
12496	12488	5	Tandiga Ward	1471
12497	12261	4	Nalusala	5795
12498	12497	5	Bugainza	651
12499	12497	5	Bugwagi	969
12500	12497	5	Bukirya	836
12501	12497	5	Bumausi	858
12502	12497	5	Bumongoti	946
12503	12497	5	Nabubolo	573
12504	12497	5	Nakibuyi	962
12505	12261	4	Namaguli	6168
12506	12505	5	Bugobbiro	950
12507	12505	5	Bulujewa	2270
12508	12505	5	Kyesha	1521
12509	12505	5	Nabweya	1427
12510	12261	4	Namugabwe	5665
12511	12510	5	Bukahengere	1232
12512	12510	5	Bumateba	840
12513	12510	5	Bumirisa	1162
12514	12510	5	Buwangolo	563
12515	12510	5	Nabana	791
12516	12510	5	Namugabwe	1077
12517	12261	4	Sironko Town Council	20374
12518	12517	5	Central Ward	2242
12519	12517	5	Industrial Ward	3382
12520	12517	5	Kibira Ward	5447
12521	12517	5	Mahempe Ward	4621
12522	12517	5	Southern Ward	4682
12523	12261	4	Zesui	7406
12524	12523	5	Bukibooli	1535
12525	12523	5	Bumumulo	969
12526	12523	5	Majenga	1876
12527	12523	5	Nabodi	1841
12528	12523	5	Shimuma	1185
12529	2	2	Soroti	266189
12530	12529	3	Dakabela County	113274
12531	12530	4	Arapai	32854
12532	12531	5	Agirigiroi	8059
12533	12531	5	Arabaka	6836
12534	12531	5	Dakabela	9939
12535	12531	5	Odudui	8020
12536	12530	4	Katine	28865
12537	12536	5	Katine	6265
12538	12536	5	Merok	3022
12539	12536	5	Ogwolo	4549
12540	12536	5	Oimai	3804
12541	12536	5	Ojama	5995
12542	12536	5	Olwelai	2912
12543	12536	5	Samuk	2318
12544	12530	4	Oculoi	21629
12545	12544	5	Abari	3097
12546	12544	5	Adamasiko	4948
12547	12544	5	Ajonyi	3572
12548	12544	5	Oculoi	4261
12549	12544	5	Ojom	5751
12550	12530	4	Tubur	23809
12551	12550	5	Achuna	4622
12552	12550	5	Aparisa	5490
12553	12550	5	Obulei	4286
12554	12550	5	Ogolai	4095
12555	12550	5	Palaet	5316
12556	12530	4	Tubur Town Council	6117
12557	12556	5	Awasi Ward	1890
12558	12556	5	Central Ward	2322
12559	12556	5	Orieta Ward	1905
12560	12529	3	Gweri County	64890
12561	12560	4	Aukot	19950
12562	12561	5	Acaboi	3778
12563	12561	5	Aukot	6417
12564	12561	5	Awoja	5282
12565	12561	5	Osuguro	4473
12566	12560	4	Awaliwal	19785
12567	12566	5	Awaliwal	3669
12568	12566	5	Damasiko	3820
12569	12566	5	Mugenya	3887
12570	12566	5	Takariamiam	3962
12571	12566	5	Telamot	4447
12572	12560	4	Gweri	25155
12573	12572	5	Abelet	5597
12574	12572	5	Dokolo	7600
12575	12572	5	Gweri	6618
12576	12572	5	Opucet	5340
12577	12529	3	Soroti County	88025
12578	12577	4	Asuret	29621
12579	12578	5	Adacar	6249
12580	12578	5	Asuret	3660
12581	12578	5	Mukura	3466
12582	12578	5	Obule	4663
12583	12578	5	Omulala	4789
12584	12578	5	Oregia	6794
12585	12577	4	Kamuda	26415
12586	12585	5	Aminit	6791
12587	12585	5	Kamuda	6247
12588	12585	5	Odina	5784
12589	12585	5	Olio	7593
12590	12577	4	Lalle	12847
12591	12590	5	Agora	1911
12592	12590	5	Gwetom	5509
12593	12590	5	Lalle	5427
12594	12577	4	Ocokican	19142
12595	12594	5	Abaango	4446
12596	12594	5	Ocokican	5235
12597	12594	5	Ocomai	4449
12598	12594	5	Omodoi	5012
12599	2	2	Soroti City	134199
12600	12599	3	Soroti East Division	82264
12601	12600	4	Soroti East Division	82264
12602	12601	5	Acetgwen Ward	1976
12603	12601	5	Akisim Ward	2265
12604	12601	5	Aloet Ward	9637
12605	12601	5	Camp Swahili Ward	7228
12606	12601	5	Central Ward	2451
12607	12601	5	Kengere Ward	7001
12608	12601	5	Kichinjanji Ward	5409
12609	12601	5	Madera Ward	9752
12610	12601	5	Moruapesur Ward	6807
12611	12601	5	Opiai Ward	12072
12612	12601	5	Opuyo Ward	12222
12613	12601	5	Otatai Ward	3739
12614	12601	5	Pioneer Ward	1705
12615	12599	3	Soroti West Division	51935
12616	12615	4	Soroti West Division	51935
12617	12616	5	Agama Ward	6147
12618	12616	5	Agora Ward	3525
12619	12616	5	Amen A Ward	4875
12620	12616	5	Amen B Ward	5672
12621	12616	5	Amoru Ward	4901
12622	12616	5	Arapai Ward	6010
12623	12616	5	Nakatunya Ward	3797
12624	12616	5	Oderai Ward	3668
12625	12616	5	Oderai/majengo Ward	1810
12626	12616	5	Orwadai Ward	4864
12627	12616	5	Pamba Ward	2967
12628	12616	5	Senior Quarters Ward	3699
12629	1	2	Ssembabule	305971
12630	12629	3	Lwemiyaga County	76156
12631	12630	4	Bulongo	10567
12632	12631	5	Bulongo	3794
12633	12631	5	Ibaare	1127
12634	12631	5	Kabukongote	956
12635	12631	5	Kakinga	1397
12636	12631	5	Karushonshomezi	1527
12637	12631	5	Rukoma	1766
12638	12630	4	Kyeera	26375
12639	12638	5	Kakoma	7618
12640	12638	5	Lubaale	9703
12641	12638	5	Makoole	9054
12642	12630	4	Lwemiyaga	17877
12643	12642	5	Kampala	4818
12644	12642	5	Lwemibu	5035
12645	12642	5	Lwensankala	8024
12646	12630	4	Nabitanga	12485
12647	12646	5	Ishara	1977
12648	12646	5	Kabaale	2657
12649	12646	5	Kirama	1886
12650	12646	5	Kyambogo	1570
12651	12646	5	Meeru	1743
12652	12646	5	Nabitanga	1590
12653	12646	5	Ntyazo	1062
12654	12630	4	Ntuusi Town Council	8852
12655	12654	5	Bwogero Ward	1584
12656	12654	5	Kamizire Ward	1645
12657	12654	5	Kanoni Ward	4487
12658	12654	5	Kashozikamwe Ward	1136
12659	12629	3	Mawogola County	70217
12660	12659	4	Mateete	27458
12661	12660	5	Kayunga	12564
12662	12660	5	Mateete	2005
12663	12660	5	Nakagongo	12889
12664	12659	4	Mateete Town Council	13581
12665	12664	5	Kasaana Ward	2584
12666	12664	5	Kiwumulo Ward	5277
12667	12664	5	Mateete Central Ward	3768
12668	12664	5	Mateete West Ward	1952
12669	12659	4	Mitete	29178
12670	12669	5	Kasambya	9057
12671	12669	5	Manyama	9692
12672	12669	5	Miteete	10429
12673	12629	3	Mawogola North County	85512
12674	12673	4	Kawanda	17068
12675	12674	5	Kasongi	4829
12676	12674	5	Kawanda	4270
12677	12674	5	Kyabi	3937
12678	12674	5	Lutunku	4032
12679	12673	4	Lugusulu	12455
12680	12679	5	Kabaarekeera	2887
12681	12679	5	Kairasya	3374
12682	12679	5	Mbuya	2387
12683	12679	5	Mwitsi	3807
12684	12673	4	Mabindo	12196
12685	12684	5	Kasaalu	3463
12686	12684	5	Kikoma	6136
12687	12684	5	Mabindo	2597
12688	12673	4	Mijwala	24784
12689	12688	5	Kanoni	5201
12690	12688	5	Kidokolo	6782
12691	12688	5	Lwabaana	5989
12692	12688	5	Nsoga	6812
12693	12673	4	Mitima	9646
12694	12693	5	Kyebando	2867
12695	12693	5	Lwentale	3398
12696	12693	5	Mitima	3381
12697	12673	4	Ssembabule Town Council	9363
12698	12697	5	Dispensary Ward	4369
12699	12697	5	Market Ward	3272
12700	12697	5	Parish Ward	1722
12701	12629	3	Mawogola West County	74086
12702	12701	4	Katwe	20380
12703	12702	5	Kenziga	5310
12704	12702	5	Kinywamazzi	8015
12705	12702	5	Lugusulu	7055
12706	12701	4	Lwebitakuli	29906
12707	12706	5	Kasambya	5711
12708	12706	5	Lwebitakuli	6355
12709	12706	5	Lwebitakuli Central	4704
12710	12706	5	Lwembogo	6617
12711	12706	5	Nankondo	6519
12712	12701	4	Nakasenyi	23800
12713	12712	5	Kabaale	7816
12714	12712	5	Nakasenyi	7069
12715	12712	5	Ntete	8915
12716	3	2	Terego	323253
12717	12716	3	Terego East County	217031
12718	12717	4	Imvepi Refugee Settlement	43074
12719	12718	5	Zone 1	17443
12720	12718	5	Zone 2	16313
12721	12718	5	Zone 3	7836
12722	12718	5	Zone 4	1482
12723	12717	4	Odupi	53354
12724	12723	5	Azaapi	6872
12725	12723	5	Imvepi	13277
12726	12723	5	Lugbari	6532
12727	12723	5	Okavu	6192
12728	12723	5	Ombokoro	5274
12729	12723	5	Orivu	9468
12730	12723	5	Otumbari	5739
12731	12717	4	Omugo	52650
12732	12731	5	Angazi	6307
12733	12731	5	Anyufira	6907
12734	12731	5	Bura	8566
12735	12731	5	Duku	3435
12736	12731	5	Ndaapi	7429
12737	12731	5	Obi	9354
12738	12731	5	Owayi	6234
12739	12731	5	Yiddu	4418
12740	12717	4	Rhino Camp Refugee Settlement	42223
12741	12740	5	Ocea Zone	529
12742	12740	5	Odobu Zone	1767
12743	12740	5	Ofua Zone	19429
12744	12740	5	Omugo Zone	12975
12745	12740	5	Siripi Zone	7523
12746	12717	4	Uriama	25730
12747	12746	5	Akinio	4870
12748	12746	5	Ejoni	5437
12749	12746	5	Katiku	2861
12750	12746	5	Maraju	7849
12751	12746	5	Otumbari	4713
12752	12716	3	Terego West County	106222
12753	12752	4	Aii-Vu	27646
12754	12753	5	Ayuri	3984
12755	12753	5	Erea	5107
12756	12753	5	Idayi	3726
12757	12753	5	Onai	4952
12758	12753	5	Onzoro	5975
12759	12753	5	Paranga	3902
12760	12752	4	Beleafe	26548
12761	12760	5	Abindi	5843
12762	12760	5	Adripi	5677
12763	12760	5	Ajiraku	5972
12764	12760	5	Nicu	9056
12765	12752	4	Katrini	35700
12766	12765	5	Anavu	5196
12767	12765	5	Ocopi	7452
12768	12765	5	Okavu	3906
12769	12765	5	Olea	4016
12770	12765	5	Olua	8735
12771	12765	5	Onzoro	6395
12772	12752	4	Leju Town Council	16328
12773	12772	5	Aawa Ward	3214
12774	12772	5	Addu Ward	2458
12775	12772	5	Alia Ward	2675
12776	12772	5	Aripia Ward	3363
12777	12772	5	Odrufuni Ward	2198
12778	12772	5	Otrevu Ward	2420
12779	2	2	Tororo	609939
12780	12779	3	Tororo Municipality	42865
12781	12780	4	Tororo Eastern	19367
12782	12781	5	Amagoro A	6878
12783	12781	5	Amagoro B	6584
12784	12781	5	Kasoli	2547
12785	12781	5	Nyangole	3358
12786	12780	4	Tororo Western	23498
12787	12786	5	Agururu A	5816
12788	12786	5	Agururu B	5549
12789	12786	5	Bison/magoria	8119
12790	12786	5	Central	4014
12791	12779	3	Tororo North County	96495
12792	12791	4	Akadot	16618
12793	12792	5	Akadot	2929
12794	12792	5	Kabiro	3503
12795	12792	5	Kamuli	4130
12796	12792	5	Kayoro	2835
12797	12792	5	Morukonyangai	3221
12798	12791	4	Apetai	13699
12799	12798	5	Aukot	3143
12800	12798	5	Kalachai	3265
12801	12798	5	Kochoge	2051
12802	12798	5	Petta	3216
12803	12798	5	Totokidwe	2024
12804	12791	4	Magodes Town Council	11579
12805	12804	5	Central Ward	3047
12806	12804	5	Ginnery Ward	1777
12807	12804	5	Moru Ward	2738
12808	12804	5	Station Ward	2128
12809	12804	5	Tuba Ward	1889
12810	12791	4	Merikit	18752
12811	12810	5	Amurwo	3553
12812	12810	5	Apokor	2290
12813	12810	5	Arowa	4157
12814	12810	5	Asinge	2162
12815	12810	5	Kalungu	3617
12816	12810	5	Maliri	2973
12817	12791	4	Merikit Town Council	11927
12818	12817	5	Central Ward	2612
12819	12817	5	Kachinga Ward	3044
12820	12817	5	Magoro Ward	3116
12821	12817	5	Merikit Ward	3155
12822	12791	4	Molo	10334
12823	12822	5	Abwal	2375
12824	12822	5	Kidoko	2345
12825	12822	5	Kipangor	2548
12826	12822	5	Papakol	3066
12827	12791	4	Mukuju	13586
12828	12827	5	Akoret	2191
12829	12827	5	Akworot	2042
12830	12827	5	Atiri	2313
12831	12827	5	Kajarau	3247
12832	12827	5	Mukuju	3793
12833	12779	3	Tororo South County	120212
12834	12833	4	Apokor Town Council	5164
12835	12834	5	Amagoro Ward	1712
12836	12834	5	Nyalakot Ward	1191
12837	12834	5	Otukuri Ward	1229
12838	12834	5	Pereje Ward	1032
12839	12833	4	Kalait	15597
12840	12839	5	Amoni	2465
12841	12839	5	Angololo	3625
12842	12839	5	Kalait	3789
12843	12839	5	Kodike	2175
12844	12839	5	Morukebu	3543
12845	12833	4	Kayoro	13231
12846	12845	5	Abur	2697
12847	12845	5	Asinget	2661
12848	12845	5	Kasipodo	5381
12849	12845	5	Kayoro	2492
12850	12833	4	Kwapa	6900
12851	12850	5	Apuwai	1175
12852	12850	5	Asinge	1269
12853	12850	5	Kojim	965
12854	12850	5	Oburi	1295
12855	12850	5	Ogirio	2196
12856	12833	4	Kwapa Town Council	8537
12857	12856	5	Amagoro Ward	2326
12858	12856	5	Kabosa Ward	1523
12859	12856	5	Kwapa B Ward	1294
12860	12856	5	Kwapa Central Ward	2409
12861	12856	5	Ochegen Ward	985
12862	12833	4	Malaba Town Council	18847
12863	12862	5	Akolodong Ward	6471
12864	12862	5	Amagoro Ward	4641
12865	12862	5	Asinge Ward	2801
12866	12862	5	Malaba Ward	2919
12867	12862	5	Obore Ward	2015
12868	12833	4	Mella	9016
12869	12868	5	Kadomoche	2756
12870	12868	5	Kinyili	2077
12871	12868	5	Koitangiro	2249
12872	12868	5	Mella	1934
12873	12833	4	Morukatipe	20409
12874	12873	5	Angolol	5917
12875	12873	5	Aputiri	5071
12876	12873	5	Morukatipe	2670
12877	12873	5	Nyalakot	6751
12878	12833	4	Osukuru Town Council	22511
12879	12878	5	Abwanget Ward	3810
12880	12878	5	Amagoro Ward	5516
12881	12878	5	Osukuru Ward	8665
12882	12878	5	Ticaf Ward	4520
12883	12779	3	West Budama Central County	82771
12884	12883	4	Mulanda	16036
12885	12884	5	Chawolo	2957
12886	12884	5	Korobudi	2462
12887	12884	5	Mulanda	5207
12888	12884	5	Pasindi	5410
12889	12883	4	Mwello	15162
12890	12889	5	Agumit	4747
12891	12889	5	Kisote	3396
12892	12889	5	Mikiya	2946
12893	12889	5	Mwello	4073
12894	12883	4	Nabuyoga	10039
12895	12894	5	Lingingi	3564
12896	12894	5	Namwanga	3316
12897	12894	5	Namwanga Central	3159
12898	12883	4	Nabuyoga Town Council	16753
12899	12898	5	Miganja Ward	4196
12900	12898	5	Muwafu Ward	5486
12901	12898	5	Nabuyoga Ward	3851
12902	12898	5	Pawanga Ward	3220
12903	12883	4	Pajwenda Town Council	14316
12904	12903	5	Amor Ward	5021
12905	12903	5	Bira Ward	3104
12906	12903	5	Pajwenda Ward	3183
12907	12903	5	Panyirenja Ward	3008
12908	12883	4	Siwa	10465
12909	12908	5	Lwala	1883
12910	12908	5	Nyamalogo	5272
12911	12908	5	Siwa	3310
12912	12779	3	West Budama County	181362
12913	12912	4	Iyolwa	8040
12914	12913	5	Auyo	2950
12915	12913	5	Nyemera	1893
12916	12913	5	Poyem	3197
12917	12912	4	Iyolwa Town Council	11844
12918	12917	5	Gule Ward	2074
12919	12917	5	Iyolwa Ward	2849
12920	12917	5	Nambogo Ward	3158
12921	12917	5	Pabone Ward	3763
12922	12912	4	Katajula	9935
12923	12922	5	Katajula	3187
12924	12922	5	Matindi	1821
12925	12922	5	Mukwana	2959
12926	12922	5	Pagoya	1968
12927	12912	4	Kisoko	22189
12928	12927	5	Gwaragwara	6476
12929	12927	5	Kisoko	5290
12930	12927	5	Morikiswa	6232
12931	12927	5	Pei-Pei	4191
12932	12912	4	Magola	23781
12933	12932	5	Gule	7380
12934	12932	5	Magola	7133
12935	12932	5	Papol	5501
12936	12932	5	Poyameri	3767
12937	12912	4	Nagongera	19546
12938	12937	5	Maundo	5343
12939	12937	5	Namwaya	5060
12940	12937	5	Okwira	4098
12941	12937	5	Pokongo	5045
12942	12912	4	Nagongera Town Council	14860
12943	12942	5	Central Ward	2090
12944	12942	5	Eastern Ward	3565
12945	12942	5	Northern Ward	4066
12946	12942	5	Southern Ward	5139
12947	12912	4	Nyangole	20025
12948	12947	5	Achilet	4703
12949	12947	5	Iyokango	2945
12950	12947	5	Nyakesi	6379
12951	12947	5	Nyangole	5998
12952	12912	4	Ojilai	8095
12953	12952	5	Bumanda	2766
12954	12952	5	Fungwe	2239
12955	12952	5	Ojilai	3090
12956	12912	4	Osia	9548
12957	12956	5	Kagwara	1958
12958	12956	5	Katerema	2513
12959	12956	5	Osia	2787
12960	12956	5	Umeme	2290
12961	12912	4	Petta	18283
12962	12961	5	Mbula	5821
12963	12961	5	Pakoi	3722
12964	12961	5	Petta	4414
12965	12961	5	Ramogi	4326
12966	12912	4	Rubongi	15216
12967	12966	5	Agola	2314
12968	12966	5	Aturukuku	1734
12969	12966	5	Kidera	2730
12970	12966	5	Panyangasi	2916
12971	12966	5	Powendo	2086
12972	12966	5	Rubongi	3436
12973	12779	3	West Budama North East County	86234
12974	12973	4	Kirewa	18286
12975	12974	5	Katandi	4106
12976	12974	5	Kirewa	8103
12977	12974	5	Senda	4282
12978	12974	5	Tindo	1795
12979	12973	4	Nawire	10202
12980	12979	5	Atapara	2289
12981	12979	5	Mius	1878
12982	12979	5	Nawire	3218
12983	12979	5	Sengo	2817
12984	12973	4	Paya	18066
12985	12984	5	Agge	1614
12986	12984	5	Barinyanga	2171
12987	12984	5	Nyasirenge	2911
12988	12984	5	Nyawimbi	1899
12989	12984	5	Padula	1934
12990	12984	5	Paragang	3483
12991	12984	5	Paya	2067
12992	12984	5	Paya Central	1987
12993	12973	4	Sere	8586
12994	12993	5	Kisia	1656
12995	12993	5	Liwira	2040
12996	12993	5	Mwenge	1872
12997	12993	5	Sere	3018
12998	12973	4	Soni	14130
12999	12998	5	Chawolo	4221
13000	12998	5	Mufumi	3502
13001	12998	5	Nagoke	2668
13002	12998	5	Soni	3739
13003	12973	4	Sopsop	16964
13004	13003	5	Nabowa	2835
13005	13003	5	Namwendia	8234
13006	13003	5	Per - Per	2825
13007	13003	5	Sop Sop	3070
13008	1	2	Wakiso	3411177
13009	13008	3	Busiro County	1460422
13010	13009	4	Bussi	19132
13011	13010	5	Balabala	4323
13012	13010	5	Bussi/kisaba	3554
13013	13010	5	Gulwe	4609
13014	13010	5	Tebankiza	3061
13015	13010	5	Zzinga	3585
13016	13009	4	Kajjansi Town Council	155058
13017	13016	5	Bulwanyi Ward	5198
13018	13016	5	Bweya Ward	23887
13019	13016	5	Kitende Ward	44612
13020	13016	5	Nakawuka Ward	9213
13021	13016	5	Namulanda Ward	25835
13022	13016	5	Nankonge Ward	4464
13023	13016	5	Ngongolo Ward	6461
13024	13016	5	Nkungulutale Ward	11311
13025	13016	5	Nsangu Ward	9082
13026	13016	5	Ssisa Ward	7916
13027	13016	5	Wamala Ward	7079
13028	13009	4	Kakiri	77174
13029	13028	5	Buwanuka	8890
13030	13028	5	Kamuli	4999
13031	13028	5	Kikandwa	18254
13032	13028	5	Lubbe	4260
13033	13028	5	Luwunga	8742
13034	13028	5	Magoggo	6678
13035	13028	5	Nampunge	11236
13036	13028	5	Sentema	14115
13037	13009	4	Kakiri Town Council	38994
13038	13037	5	Bukalango Ward	3680
13039	13037	5	Busujja Ward	7315
13040	13037	5	Kakiri Ward	5637
13041	13037	5	Kikubampanga Ward	10753
13042	13037	5	Lugeye Ward	4190
13043	13037	5	Nakyerongosa Ward	7419
13044	13009	4	Kasanje Town Council	46962
13045	13044	5	Bulumbu	7154
13046	13044	5	Jungo	9886
13047	13044	5	Kasanje	9997
13048	13044	5	Mako	3304
13049	13044	5	Sokolo	5204
13050	13044	5	Ssazi	7115
13051	13044	5	Zziba	4302
13052	13009	4	Katabi Town Council	169602
13053	13052	5	Kabaale Ward	34669
13054	13052	5	Kisubi Ward	35670
13055	13052	5	Kitala Ward	36669
13056	13052	5	Nalugala Ward	23929
13057	13052	5	Nkumba Ward	38665
13058	13009	4	Kyengera Town Council	311112
13059	13058	5	Buddo Ward	23742
13060	13058	5	Kasenge Ward	62721
13061	13058	5	Katereke Ward	16794
13062	13058	5	Kikajjo Ward	51173
13063	13058	5	Kisozi Ward	38215
13064	13058	5	Kyengera Ward	40954
13065	13058	5	Maya Ward	15971
13066	13058	5	Nabbingo Ward	31110
13067	13058	5	Nanziga Ward	7382
13068	13058	5	Nsangi Ward	23050
13069	13009	4	Masuliita	22247
13070	13069	5	Bbaale	2315
13071	13069	5	Kyengeza	5329
13072	13069	5	Lugungude	2530
13073	13069	5	Lwemwedde	4349
13074	13069	5	Mmanze	3065
13075	13069	5	Nakikungube	1903
13076	13069	5	Tumbaali	2756
13077	13009	4	Masuliita Town Council	18669
13078	13077	5	Bbika Ward	4004
13079	13077	5	Kanzize Ward	4344
13080	13077	5	Katikamu Ward	3400
13081	13077	5	Masuliita Ward	6921
13082	13009	4	Mende	65069
13083	13082	5	Baka	13429
13084	13082	5	Bbanda	8619
13085	13082	5	Kaliiti	21097
13086	13082	5	Mende	10864
13087	13082	5	Namusera	11060
13088	13009	4	Namayumba	26518
13089	13088	5	Bbembe	6487
13090	13088	5	Bukondo	4778
13091	13088	5	Kanziro	3196
13092	13088	5	Kitayita	4672
13093	13088	5	Kyasa	3782
13094	13088	5	Nakedde	3603
13095	13009	4	Namayumba Town Council	29130
13096	13095	5	Kyampisi Ward	3442
13097	13095	5	Kyanuna Ward	8531
13098	13095	5	Luguzi Ward	13123
13099	13095	5	Luttisi Ward	4034
13100	13009	4	Wakiso	389695
13101	13100	5	Bukasa	38407
13102	13100	5	Buloba	51417
13103	13100	5	Kyebando	124833
13104	13100	5	Lukwanga	23218
13105	13100	5	Nakabugo	72291
13106	13100	5	Naluvule	17147
13107	13100	5	Sumbwe	62382
13108	13009	4	Wakiso Town Council	91060
13109	13108	5	Gombe Ward	15179
13110	13108	5	Kasengejje Ward	16127
13111	13108	5	Kavumba Ward	13278
13112	13108	5	Kisimbiri Ward	17505
13113	13108	5	Mpunga Ward	14570
13114	13108	5	Namusera Ward	14401
13115	13008	3	Entebbe Municipality	81160
13116	13115	4	Division A	47107
13117	13116	5	Central	25093
13118	13116	5	Katabi	22014
13119	13115	4	Division B	34053
13120	13119	5	Kigungu	9760
13121	13119	5	Kiwafu	24293
13122	13008	3	Kira Municipality	459827
13123	13122	4	Bweyogerere Division	151870
13124	13123	5	Bweyogerere Ward	68097
13125	13123	5	Kirinya Ward	83773
13126	13122	4	Kira Division	118434
13127	13126	5	Kimwanyi Ward	43762
13128	13126	5	Kira Ward	74672
13129	13122	4	Namugongo Division	189523
13130	13129	5	Kireka Ward	115894
13131	13129	5	Kyaliwajjala Ward	73629
13132	13008	3	Kyadondo County	277685
13133	13132	4	Kasangati Town Council	277685
13134	13133	5	Bulamu Ward	41205
13135	13133	5	Gayaza Ward	32591
13136	13133	5	Kabubbu Ward	28331
13137	13133	5	Katadde Ward	19531
13138	13133	5	Kiteezi Ward	41485
13139	13133	5	Masooli Ward	22887
13140	13133	5	Nangabo Ward	23986
13141	13133	5	Wampewo Ward	46466
13142	13133	5	Wattuba Ward	21203
13143	13008	3	Makindye-Ssabagabo Municipality	439605
13144	13143	4	Bunamwaya Division	91893
13145	13144	5	Bunamwaya Ward	51968
13146	13144	5	Mutundwe Ward	39925
13147	13143	4	Masajja Division	200711
13148	13147	5	Busabala Ward	92852
13149	13147	5	Masajja Ward	39578
13150	13147	5	Namasuba	68281
13151	13143	4	Ndejje Division	147001
13152	13151	5	Mutungo Ward	38953
13153	13151	5	Ndejje Ward	86815
13154	13151	5	Seguku Ward	21233
13155	13008	3	Nansana Municipality	692478
13156	13155	4	Busukuma Division	79099
13157	13156	5	Busukuma	12464
13158	13156	5	Guluddene	7446
13159	13156	5	Kabuumba	5094
13160	13156	5	Kikoko	5853
13161	13156	5	Kiwenda	14900
13162	13156	5	Lugo	10604
13163	13156	5	Magigye	17421
13164	13156	5	Wamirongo	5317
13165	13155	4	Gombe Division	161108
13166	13165	5	Buwambo Ward	25662
13167	13165	5	Gombe Ward	9405
13168	13165	5	Jaggala Ward	12635
13169	13165	5	Kiryamuli Ward	12991
13170	13165	5	Matugga Ward	51084
13171	13165	5	Migadde Ward	6864
13172	13165	5	Mwererwe Ward	5548
13173	13165	5	Nasse Ward	4960
13174	13165	5	Ssanga Ward	16188
13175	13165	5	Tikalu Ward	7540
13176	13165	5	Wambale Ward	8231
13177	13155	4	Nabweru Division	233579
13178	13177	5	Kawanda	33734
13179	13177	5	Maganjo	76333
13180	13177	5	Nakyesanja	31803
13181	13177	5	Wamala	91709
13182	13155	4	Nansana Division	218692
13183	13182	5	Kazo Ward	44526
13184	13182	5	Nabweru North Ward	37110
13185	13182	5	Nabweru South Ward	24603
13186	13182	5	Nansana 7/8 Ochieng Ward	29995
13187	13182	5	Nansana East Ward	41651
13188	13182	5	Nansana West Ward	40807
13189	3	2	Yumbe	945100
13190	13189	3	Aringa County	230786
13191	13190	4	Bidi Bidi Refugee Camp	30379
13192	13191	5	Ajuji	366
13193	13191	5	Akuuru	11615
13194	13191	5	Komgbe	7085
13195	13191	5	Logbodo	4425
13196	13191	5	Yoyo	6888
13197	13190	4	Bijo	45666
13198	13197	5	Alelinga	2763
13199	13197	5	Aliapi	2812
13200	13197	5	Bura	2998
13201	13197	5	Dukurenga	1674
13202	13197	5	Geya	3651
13203	13197	5	Gilla	2975
13204	13197	5	Lomunga	6468
13205	13197	5	Meroba	3724
13206	13197	5	Midia	4873
13207	13197	5	Neringa	3355
13208	13197	5	Ojinga	4224
13209	13197	5	Ojiri	1885
13210	13197	5	Ujji	4264
13211	13190	4	Kululu	18568
13212	13211	5	Ajuji	3342
13213	13211	5	Akuuru	273
13214	13211	5	Dongoloto	3598
13215	13211	5	Dradranga	638
13216	13211	5	Ewafa	2776
13217	13211	5	Komgbe	2585
13218	13211	5	Kulacha	1006
13219	13211	5	Logbodo	695
13220	13211	5	Omvuzoku	1804
13221	13211	5	Yoyo	1851
13222	13190	4	Kuru	42053
13223	13222	5	Alinga	5141
13224	13222	5	Gojuru	3900
13225	13222	5	Imvenga	9511
13226	13222	5	Libua	6918
13227	13222	5	Mechu	3820
13228	13222	5	Renda	9325
13229	13222	5	Rogale	3438
13230	13190	4	Kuru Town Council	28238
13231	13230	5	Ambala Ward	5068
13232	13230	5	Gojuru Ward	5877
13233	13230	5	Mazanga Ward	4885
13234	13230	5	Omba Ward	8920
13235	13230	5	Rogale Ward	3488
13236	13190	4	Yumbe Town Council	65882
13237	13236	5	Amanyiri Ward	6529
13238	13236	5	Ariguyi Ward	10935
13239	13236	5	Arunga	4099
13240	13236	5	Bilewu Ward	11746
13241	13236	5	Charanga Ward	11452
13242	13236	5	Lukutua Ward	7024
13243	13236	5	Peace Ward	6647
13244	13236	5	Rube Ward	7450
13245	13189	3	Aringa East County	238912
13246	13245	4	Apo	35132
13247	13246	5	Alilia	3804
13248	13246	5	Aringa	3824
13249	13246	5	Banika	3698
13250	13246	5	Bijo	3223
13251	13246	5	Kena	2945
13252	13246	5	Kerila	6085
13253	13246	5	Orinzi	6399
13254	13246	5	Pena	5154
13255	13245	4	Aria	37815
13256	13255	5	Acholi	4336
13257	13255	5	Aranga	5355
13258	13255	5	Aria	2323
13259	13255	5	Bilijia	3815
13260	13255	5	Kowonga	3481
13261	13255	5	Kuba	6337
13262	13255	5	Piajo	6284
13263	13255	5	Yeta	5884
13264	13245	4	Barakala Town Council	28583
13265	13264	5	Idralu Ward	4602
13266	13264	5	Lomirui Ward	9967
13267	13264	5	Nonoko Ward	10833
13268	13264	5	Ofonze Ward	3181
13269	13245	4	Bidi Bidi Refugee Camp	59028
13270	13269	5	Bidibidi	7050
13271	13269	5	Bidibidi Refugee Camp	4246
13272	13269	5	Idralu Ward	776
13273	13269	5	Ofonze Ward	13004
13274	13269	5	Ombachi	9175
13275	13269	5	Swinga	7157
13276	13269	5	Yayari	17620
13277	13245	4	Kochi	32151
13278	13277	5	Gborogborochu	2574
13279	13277	5	Goboro	4238
13280	13277	5	Kegburu	2134
13281	13277	5	Kelurunga	1145
13282	13277	5	Kena	3625
13283	13277	5	Kochi	4146
13284	13277	5	Lokpe	2606
13285	13277	5	Lombe	1983
13286	13277	5	Munduchaku	3645
13287	13277	5	Nabara	2876
13288	13277	5	Ombechi	3179
13289	13245	4	Lori	23097
13290	13289	5	Kalamgba	1366
13291	13289	5	Kandiya	2116
13292	13289	5	Koloro	2876
13293	13289	5	Limidia	3075
13294	13289	5	Okoi	2472
13295	13289	5	Ombachi	7432
13296	13289	5	Yayari	3760
13297	13245	4	Romogi	23106
13298	13297	5	Bidibidi	3115
13299	13297	5	Chabili	4217
13300	13297	5	Eyete	3613
13301	13297	5	Kiri	3605
13302	13297	5	Legu	2766
13303	13297	5	Locomgbo	2853
13304	13297	5	Swinga	2937
13305	13189	3	Aringa North County	229413
13306	13305	4	Arilo	41805
13307	13306	5	Ajoka	3710
13308	13306	5	Bori	4006
13309	13306	5	Gichara	5198
13310	13306	5	Gimere	2593
13311	13306	5	Gotri	2299
13312	13306	5	Jalata	3203
13313	13306	5	Joke	3182
13314	13306	5	Koka	3803
13315	13306	5	Lulurunga	1535
13316	13306	5	Magu	3284
13317	13306	5	Rukuja	3103
13318	13306	5	Tuliki	5889
13319	13305	4	Kei	41582
13320	13319	5	Akia	2634
13321	13319	5	Awoba	6177
13322	13319	5	Bizee	6540
13323	13319	5	Dukulia	5277
13324	13319	5	Giro	2305
13325	13319	5	Gobu	4073
13326	13319	5	Machabo	2947
13327	13319	5	Osukia	3077
13328	13319	5	Palaja	2478
13329	13319	5	Rodo	4082
13330	13319	5	Udrubi	1992
13331	13305	4	Kerwa	40518
13332	13331	5	Kendra	6813
13333	13331	5	Kerwa	2907
13334	13331	5	Kopionga	6275
13335	13331	5	Kupia	1327
13336	13331	5	Limu	7110
13337	13331	5	Lui	2091
13338	13331	5	Mijikita	4237
13339	13331	5	Rodo	5446
13340	13331	5	Tigawate	4312
13341	13305	4	Lobe Town Council	29406
13342	13341	5	Akaya Ward	3542
13343	13341	5	Kanabu Ward	4565
13344	13341	5	Kululua Ward	5045
13345	13341	5	Noki Ward	3361
13346	13341	5	Turu Ward	4954
13347	13341	5	Urungu Ward	2841
13348	13341	5	Yakata Ward	5098
13349	13305	4	Midigo	25940
13350	13349	5	Kopua	772
13351	13349	5	Medenga	7093
13352	13349	5	Migo	5516
13353	13349	5	Mocha	3038
13354	13349	5	Mulumbe	9521
13355	13305	4	Midigo Town Council	23533
13356	13355	5	Adronga Ward	2691
13357	13355	5	Araa Ward	6989
13358	13355	5	Kujua Ward	2539
13359	13355	5	Limbe Ward	3275
13360	13355	5	Loya Ward	3912
13361	13355	5	Otre Ward	4127
13362	13305	4	Wandi	26629
13363	13362	5	Kobbe	6605
13364	13362	5	Luro	4344
13365	13362	5	Osubira	3477
13366	13362	5	Wandi	2072
13367	13362	5	Wangoro	5465
13368	13362	5	Wogo	4666
13369	13189	3	Aringa South County	245989
13370	13369	4	Arafa	26207
13371	13370	5	Adibo	4292
13372	13370	5	Aupi	4197
13373	13370	5	Dimu	3298
13374	13370	5	Olivu	6119
13375	13370	5	Omgbokolo	2253
13376	13370	5	Oyaa	3190
13377	13370	5	Pajama	2858
13378	13369	4	Ariwa	19393
13379	13378	5	Awinga	2677
13380	13378	5	Ikafe	4512
13381	13378	5	Okuyo	5391
13382	13378	5	Rigbonga	6813
13383	13369	4	Bidi Bidi Refugee Camp	33531
13384	13383	5	Abara	2729
13385	13383	5	Awinga	3321
13386	13383	5	Bangatuti	5393
13387	13383	5	Chema	975
13388	13383	5	Ikafe	1527
13389	13383	5	Oluba	7008
13390	13383	5	Otakua	4538
13391	13383	5	Rigbonga	8040
13392	13369	4	Drajini	17593
13393	13392	5	Arubaku	2108
13394	13392	5	Dondi	2144
13395	13392	5	Mongoyo	3597
13396	13392	5	Olivu	2914
13397	13392	5	Paladru	2726
13398	13392	5	Yaa	4104
13399	13369	4	Kulikulinga Town Council	14100
13400	13399	5	Kulikulinga Ward	4741
13401	13399	5	Nyai Ward	2476
13402	13399	5	Odruo Ward	2926
13403	13399	5	Pamua Ward	3957
13404	13369	4	Lodonga	30182
13405	13404	5	Driwala	4211
13406	13404	5	Nyori	11996
13407	13404	5	Orogbo	6312
13408	13404	5	Yumele	7663
13409	13369	4	Lodonga Town Council	29357
13410	13409	5	Galaba Ward	6889
13411	13409	5	Limuru	3464
13412	13409	5	Luzira Ward	3494
13413	13409	5	Mijale Ward	4621
13414	13409	5	Rembeta Ward	4550
13415	13409	5	Yiba Ward	6339
13416	13369	4	Odravu	44819
13417	13416	5	Arumadri	3727
13418	13416	5	Bangatuti	4840
13419	13416	5	Bijo	1359
13420	13416	5	Chema	3539
13421	13416	5	Ibabiri	3597
13422	13416	5	Ludara	4666
13423	13416	5	Machule	3702
13424	13416	5	Moju	1980
13425	13416	5	Moli	2659
13426	13416	5	Mugoju	2752
13427	13416	5	Olukenga	1873
13428	13416	5	Onoko	2034
13429	13416	5	Rimbe	3518
13430	13416	5	Wolo	4573
13431	13369	4	Odravu West	30807
13432	13431	5	Abara	2014
13433	13431	5	Aji	3033
13434	13431	5	Ambelechu	2328
13435	13431	5	Aniti	1219
13436	13431	5	Aranga	4026
13437	13431	5	Ayuri	2614
13438	13431	5	Godria	2328
13439	13431	5	Ikufe	2369
13440	13431	5	Lui	3221
13441	13431	5	Nyoko	1425
13442	13431	5	Oluba	1413
13443	13431	5	Otakua	2805
13444	13431	5	Pakayo	2012
13445	3	2	Zombo	312621
13446	13445	3	Okoro County	173278
13447	13446	4	Abanga	19454
13448	13447	5	Asina	4642
13449	13447	5	Pakadha	3447
13450	13447	5	Pamitu	3253
13451	13447	5	Serr	4552
13452	13447	5	Thanga	3560
13453	13446	4	Athuma	12460
13454	13453	5	Abaji	2718
13455	13453	5	Leda	3763
13456	13453	5	Olyeko	3081
13457	13453	5	Zulume	2898
13458	13446	4	Jangokoro	18912
13459	13458	5	Afuda	5064
13460	13458	5	Congambe	5339
13461	13458	5	Patek	2791
13462	13458	5	Yada	5718
13463	13446	4	Nyapea	23568
13464	13463	5	Abeju	5379
13465	13463	5	Mundhel	5942
13466	13463	5	Ombila	3238
13467	13463	5	Osoye	3229
13468	13463	5	Oyeyo	5780
13469	13446	4	Padea Town Council	16108
13470	13469	5	Dindo Ward	9809
13471	13469	5	Jupadindo Ward	6299
13472	13446	4	Paidha	21470
13473	13472	5	Amei	4616
13474	13472	5	Cana	5756
13475	13472	5	Kaya	4784
13476	13472	5	Otheko	6314
13477	13446	4	Paidha Town Council	42733
13478	13477	5	Central Ward	4257
13479	13477	5	Dwonga Ward	7209
13480	13477	5	Nyibola Ward	7520
13481	13477	5	Omua Ward	5348
13482	13477	5	Oturgang Ward	11172
13483	13477	5	Zingili Ward	7227
13484	13446	4	Zombo Town Council	18573
13485	13484	5	Abira East Ward	6519
13486	13484	5	Abira West Ward	6790
13487	13484	5	Paley West Ward	5264
13488	13445	3	Ora County	139343
13489	13488	4	Akaa	19015
13490	13489	5	Abanga	2557
13491	13489	5	Amuda	4228
13492	13489	5	Ayaka	6103
13493	13489	5	Jupamatho	6127
13494	13488	4	Alangi	27061
13495	13494	5	Ambele	3460
13496	13494	5	Angar	3270
13497	13494	5	Gamba	4410
13498	13494	5	Ndara	4873
13499	13494	5	Pasai	11048
13500	13488	4	Atyak	23203
13501	13500	5	Angol	6354
13502	13500	5	Anyola	8947
13503	13500	5	Ogusi	5143
13504	13500	5	Pamach	2759
13505	13488	4	Kango	18784
13506	13505	5	Alube	4060
13507	13505	5	Oliri	5615
13508	13505	5	Omua	3979
13509	13505	5	Paduba	5130
13510	13488	4	Warr	8974
13511	13510	5	Ngira	1870
13512	13510	5	Pagei	2681
13513	13510	5	Pakia	4423
13514	13488	4	Warr Town Council	15767
13515	13514	5	Affere Ward	4378
13516	13514	5	Juloka Ward	8936
13517	13514	5	Omua Lower Ward	2453
13518	13488	4	Zeu	26539
13519	13518	5	Kigezi	4427
13520	13518	5	Lendu	6286
13521	13518	5	Lorr Central	5994
13522	13518	5	Omoyo	3906
13523	13518	5	Papoga	5926
13524	3	2	Apaa	9456
\.

CREATE TEMP TABLE _idmap (tmp_id INTEGER PRIMARY KEY, real_id INTEGER NOT NULL)
  ON COMMIT DROP;

DO $seed$
DECLARE
  lv      SMALLINT;
  r       RECORD;
  pid     INTEGER;
  new_id  INTEGER;
  made    INTEGER := 0;
  reused  INTEGER := 0;
BEGIN
  FOR lv IN 1..5 LOOP
    FOR r IN SELECT * FROM _stage WHERE lvl = lv ORDER BY tmp_id LOOP

      IF r.tmp_parent IS NULL THEN
        pid := NULL;
      ELSE
        SELECT real_id INTO pid FROM _idmap WHERE tmp_id = r.tmp_parent;
        IF pid IS NULL THEN
          RAISE EXCEPTION 'seed: parent tmp_id % missing for "%"', r.tmp_parent, r.name;
        END IF;
      END IF;

      INSERT INTO locations (parent_id, level, name, population)
      VALUES (pid, r.lvl, r.name, r.pop)
      ON CONFLICT (COALESCE(parent_id, 0), name_norm) DO NOTHING
      RETURNING id INTO new_id;

      IF new_id IS NULL THEN
        SELECT id INTO new_id
          FROM locations
         WHERE COALESCE(parent_id, 0) = COALESCE(pid, 0)
           AND name_norm = lower(unaccent(r.name));
        reused := reused + 1;
      ELSE
        made := made + 1;
      END IF;

      INSERT INTO _idmap (tmp_id, real_id) VALUES (r.tmp_id, new_id);
    END LOOP;
    RAISE NOTICE 'level % done', lv;
  END LOOP;

  RAISE NOTICE 'seed complete: % inserted, % already present', made, reused;
END;
$seed$;

-- Belt and braces for any district row that predates the trigger.
UPDATE locations SET district_id = id WHERE level = 2 AND district_id IS NULL;

-- ---------------------------------------------------------------------
-- Verification — read these before you COMMIT
-- ---------------------------------------------------------------------
SELECT level,
       CASE level WHEN 1 THEN 'Region' WHEN 2 THEN 'District'
                  WHEN 3 THEN 'County/Municipality' WHEN 4 THEN 'Sub-county/Division'
                  WHEN 5 THEN 'Parish/Ward' ELSE 'Village/Cell' END AS unit,
       COUNT(*)
  FROM locations GROUP BY level ORDER BY level;
-- expected: 4 / 147 / 312 / 2207 / 10854

SELECT id, level, label, population FROM locations WHERE name_norm = 'luzira';

SELECT COUNT(*) AS orphans FROM locations WHERE level > 1 AND parent_id IS NULL;
SELECT COUNT(*) AS bad_paths FROM locations WHERE path IS NULL OR path = '';
-- both expected: 0

COMMIT;
