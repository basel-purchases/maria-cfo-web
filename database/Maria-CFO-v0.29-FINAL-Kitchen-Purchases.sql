-- Maria CFO Web v0.29 FINAL - historical Al-Ameen purchase invoices for kitchen materials
-- Requires v0.24, v0.27, v0.28 and v0.29 migrations before this file.
-- Execute AFTER your explicitly confirmed reset (if you choose to reset).
-- Historical posted purchase invoices are visible in Purchases, but excluded from
-- new supplier debts: source omits supplier, payment method and paid/unpaid status.
-- NO payments or cashbox movements are created for historical imports.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ameen_kitchen_catalog_v029 (
  source_code text PRIMARY KEY,
  material_name text NOT NULL,
  base_unit_name text NOT NULL,
  reference_quantity numeric NOT NULL CHECK (reference_quantity>=0),
  requires_review boolean NOT NULL DEFAULT false
);
-- Reference warehouse allowlist is immutable to web clients.
ALTER TABLE public.ameen_kitchen_catalog_v029 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ameen_kitchen_catalog_v029 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ameen_kitchen_catalog_v029 TO authenticated;
DROP POLICY IF EXISTS ameen_kitchen_owner_read_v029 ON public.ameen_kitchen_catalog_v029;
CREATE POLICY ameen_kitchen_owner_read_v029 ON public.ameen_kitchen_catalog_v029
FOR SELECT TO authenticated USING (public.is_app_owner());

-- BEGIN GENERATED SOURCE CATALOG SEED. Exactly 397 materials.
-- GENERATED FROM USER-SUPPLIED INVENTORY AND PURCHASE FILES. READ BEFORE APPLYING.
-- Exactly 397 source code-to-name mappings, 3 unresolved unit pairs.
INSERT INTO public.ameen_kitchen_catalog_v029(source_code,material_name,base_unit_name,reference_quantity,requires_review) VALUES
 ('2001001','ثوم','غرام',49250,false),
 ('2001002','باذنجان كبير','غرام',1190200,false),
 ('2001003','باذنجان صغير','غرام',4500,false),
 ('2001004','جزر','غرام',185000,false),
 ('2001006','لفت','غرام',8000,false),
 ('2001007','كزبرة','غرام',19000,false),
 ('2001008','ملفوف ابيض','غرام',125100,false),
 ('2001011','بصل ابيض','غرام',434500,false),
 ('2001013','خيار','غرام',503300,false),
 ('2001014','كوسا','غرام',103000,false),
 ('2001016','فاصولياء خضراء','غرام',3500,false),
 ('2001017','خس بلدي','غرام',1007500,false),
 ('2001019','نعنع اخضر','ربطة',558,false),
 ('2001020','بقلة','ربطة',362,false),
 ('2001021','بقدونس','ربطة',111044,false),
 ('2001023','فليفلة حارة','غرام',9500,false),
 ('2001024','فليفلة حلوة','غرام',115000,false),
 ('2001025','بطاطا سبونتا','غرام',2778850,false),
 ('2001026','فطر طازج','غرام',2000,false),
 ('2001027','فجل','ربطة',19,false),
 ('2001028','بندورة','غرام',1784000,false),
 ('2001030','فول اخضر','غرام',2000,false),
 ('2001033','زعتر اخضر','ربطة',320,false),
 ('2001034','ورق عنب','غرام',47300,false),
 ('2001035','جرجير','ربطة',965,false),
 ('2001036','فليفلة حمراء','غرام',57300,false),
 ('2001037','بندورة كرزية','علبة',50,false),
 ('2001038','ملفوف احمر','غرام',38300,false),
 ('2001040','اكياس بازلاء خضراء','كيس',4,false),
 ('2001041','بصل صغير للشوي','غرام',40000,false),
 ('2001042','بطاطا سبونتا مقطعة','كغ',465,false),
 ('2001043','انجاص','كغ',33.800000000000004,false),
 ('2001044','شوندر','كغ',22,false),
 ('2002003','كرز','غرام',3000,false),
 ('2002004','ليمون','غرام',938200,false),
 ('2002007','برتقال للعصير','غرام',12000,false),
 ('2002008','برتقال','غرام',330100,false),
 ('2002009','دراق','غرام',5100,false),
 ('2002011','تفاح اصفر','غرام',53000,false),
 ('2002012','نجاص','غرام',5700,false),
 ('2002014','خوخ احمر','غرام',213500,false),
 ('2002015','عنب ابيض','غرام',436100,false),
 ('2002016','عنب احمر','غرام',220600,false),
 ('2002020','جبس (بطيخ احمر)','غرام',198500,false),
 ('2002022','موز','غرام',146650,false),
 ('2002023','تين','غرام',4500,false),
 ('2002026','افوكادو','غرام',4000,false),
 ('2002027','كيوي','غرام',16500,false),
 ('2003003','كريمة طبخ','عبوة',198,false),
 ('2003004','لبن بقر','غرام',95000,false),
 ('2003005','لبنة بلدي','غرام',103500,false),
 ('2003006','قشطة معلبة','علبة',72,false),
 ('2003008','حليب بقر','غرام',152400,false),
 ('2003009','حليب ظروف','ظرف',5,false),
 ('2003010','لبن غنم','غرام',24000,false),
 ('2003011','حليب معلب','مل',562800,false),
 ('2003012','حليب بودرة','كيس',14004,false),
 ('2003013','لبنة معلبة','علبة',4,false),
 ('2003014','قريشة','كغ',8,false),
 ('20042','بيض عادي','صحن',38,false),
 ('2005001','جبنة موزاريلا','غرام',238000,false),
 ('2005002','جبنة غودي','غرام',12300,false),
 ('2005003','جبنة بلدية','غرام',110500,false),
 ('2005004','جبنة مشللة','غرام',11000,false),
 ('2005005','جبنة حلوم','غرام',400,false),
 ('2005008','جبنة فيتا','غرام',19520,false),
 ('2005009','جبنة شيدر','قطعة',1001,false),
 ('2005010','ريكفورت','قطعة',20,false),
 ('2005011','البوادي جبنة شيدر 200 غ','قطعة',2,false),
 ('2005012','كرافت جبنة شيدر 100 غ','قطعة',2,false),
 ('2005013','بوك جبنة مربعات','قطعة',26,false),
 ('2005014','جبنة حلوة','كغ',1,false),
 ('2006001','لحمة غنم حمراء','غرام',1071700,false),
 ('2006002','لية غنم','غرام',24250,false),
 ('2006003','موزات ضان','غرام',1500,false),
 ('2006004','شحمة','غرام',7000,false),
 ('2007003','هبرة عجل','غرام',191500,false),
 ('2007004','نقانق','غرام',136500,false),
 ('2007005','ظهرات + فتايل عجل','غرام',200670,false),
 ('2007006','شهباء عجل','غرام',23100,false),
 ('2007007','سودة عجل','كغ',0.5,false),
 ('2007008','كبة','قرص',125,false),
 ('2007009','مضفورة','قطعة',40,false),
 ('200901','فيليه سمك','كغ',5,false),
 ('2011001','مخلل خيار','غرام',59000,false),
 ('2011002','مخلل فليفلة','غرام',11340,false),
 ('2011003','مخلل مشكل','غرام',46000,false),
 ('2011004','مخلل لفت','غرام',28130,false),
 ('2011005','مخلل باذنجان','غرام',1000,false),
 ('201201','فواكه مجففة مصرية','غرام',5000,false),
 ('2013001','خميرة تركية','ظرف',7180,false),
 ('2013002','طحين','غرام',396000,false),
 ('2013005','خبز عادي','ربطة',151,false),
 ('2013006','خبز سياحي','ربطة',1159,false),
 ('2013009','محسن خبز','غرام',1000,false),
 ('2013010','معكرونة فوتوتشيني','باكيت',2014,false),
 ('2013012','توست محمص','غرام',11000,false),
 ('2013013','كعك مطحون','غرام',82500,false),
 ('2013014','بكمبودر','ظرف',115,false),
 ('2013015','فانيليا','ظرف',165,false),
 ('2013016','عجينة سمبوسك','علبة',3,false),
 ('2013017','رقائق الاوزي و البقلاوة','علبة',2,false),
 ('2013018','معكرونة اشكال','غرام',1000,false),
 ('2013019','توست قوالب','قالب',26,false),
 ('2013020','معكرونة سباغيتي','باكيت',9000,false),
 ('2013021','نشاء','كغ',80,false),
 ('2015001','زيتون اسود','غرام',26000,false),
 ('2015002','زيتون اخضر','غرام',6500,false),
 ('2015003','زيتون اخضر شرايح','غرام',7000,false),
 ('2015004','زيتون اسود شرايح','غرام',5000,false),
 ('2015006','مكدوس','غرام',50000,false),
 ('2015007','حلاوة','غرام',5500,false),
 ('2015008','سوركي','غرام',51000,false),
 ('2015009','دبس فليفة','غرام',72000,false),
 ('2015010','دبس بندورة','غرام',29000,false),
 ('2015011','دبس رمان','كغ',30131.5,false),
 ('2015012','طحينية','غرام',186000,false),
 ('2015013','خل ابيض','مل',14500,false),
 ('2015014','خل تفاح','مل',22000,false),
 ('2015015','كاتشاب','غرام',71400,false),
 ('2015016','فطر فريش','غرام',37050,false),
 ('2015017','مكعبات مرقة دجاج 24 قطعة','قطعة',96,false),
 ('2015018','صوص صويا','غرام',3200,false),
 ('2015019','خردل','مطربان',7401,true),
 ('2015020','هوت صوص','قنينة',4005,true),
 ('2015021','كاتشاب ( عصارة )','قطعة',12,false),
 ('2015022','هوت صوص زجاج (صغير )','قطعة',12,false),
 ('2015023','شرايح اناناس','قطعة',73,false),
 ('2015024','صوص ماجي','غرام',460,false),
 ('2015025','كعك ياباني','غرام',67000,false),
 ('2015026','روستو حبش مدخن','غرام',5700,false),
 ('2015027','سلامة','غرام',1800,false),
 ('2015028','مرتديلا','علبة',4031,true),
 ('2015029','بصطرمة مغلفة','غرام',150,false),
 ('2015030','روستو دجاج مدخن','غرام',81600,false),
 ('2015031','بيبروني رول','غرام',3800,false),
 ('2015033','صلصة بيتزا','غرام',13500,false),
 ('2015034','مايونيز','غرام',1400,false),
 ('2015035','مربى توت ','قطرميز',5,false),
 ('2015036','مربى فريز','قطرميز',9,false),
 ('2015037','فطر معلب حبة كاملة','علبة',6,false),
 ('2015038','فطر مقطع','غرام',59000,false),
 ('2015039','طون','علبة',3,false),
 ('2015040','ذرة حلوة','علبة',15031,false),
 ('2015041','ارضي شوكي','قطرميز',11905,false),
 ('2015042','هليون اخضر','علبة',1041.73,false),
 ('2015043','فاصولياء حمرا كيس','كيس',2,false),
 ('2015044','شوكولا سطل','غرام',6000,false),
 ('2015045','يالنجي','غرام',1500,false),
 ('2015046','مربى مشمش','قطرميز',13,false),
 ('2015047','خل بلسميك','عبوة',3,false),
 ('2015048','شطة علب','غرام',4300,false),
 ('2015049','بالميتو','غرام',8000,false),
 ('2015050','ذرة اصابع','علبة',10,false),
 ('2015051','شرايح اناناس صغير','قطعة',28,false),
 ('2015052','زيتون محشي','كغ',3.5,false),
 ('2015053','صوص باربيكيو','قطعة',1,false),
 ('2015054','فول معلب','علبة',34,false),
 ('2015055','هوت دوغ نيرز','قطعة',180.00000000000003,false),
 ('2015056','هوت دوغ التغذية','قطعة',380.00000000000006,false),
 ('2017001','بهار اسود حب','غرام',4500,false),
 ('2017002','بهار اسود ناعم','غرام',2250,false),
 ('2017003','بهار ابيض حب','غرام',4000,false),
 ('2017004','كبش قرنفل','غرام',1000,false),
 ('2017005','قرفة عيدان','غرام',1250,false),
 ('2017006','ورق غار','غرام',1000,false),
 ('2017007','روزميري','غرام',500,false),
 ('2017008','جوزة الطيب','غرام',500,false),
 ('2017009','زنجبيل حب','غرام',1000,false),
 ('2017010','هال حب','غرام',500,false),
 ('2017011','شطة','غرام',5300,false),
 ('2017012','بابريكا وسط حلوة','غرام',3250,false),
 ('2017013','كزبرة حب','غرام',7500,false),
 ('2017014','كمون حب','غرام',4000,false),
 ('2017015','يانسون حب','غرام',500,false),
 ('2017016','اوريغانو','غرام',3000,false),
 ('2017018','كاري بودرة','غرام',5000,false),
 ('2017019','نعنع يابس','غرام',3000,false),
 ('2017020','حبق','غرام',500,false),
 ('2017021','محلب حب','غرام',1000,false),
 ('2017022','حبة بركة','غرام',3000,false),
 ('2017023','شمرة','غرام',500,false),
 ('2017024','خولنجان','غرام',1000,false),
 ('2017025','لومي','غرام',1000,false),
 ('2017026','عصفر','غرام',1000,false),
 ('2017027','زعتر احمر','غرام',2000,false),
 ('2017028','سمسم محمص','غرام',1000,false),
 ('2017029','ثوم بودرة','غرام',2000,false),
 ('2017030','بصل بودرة','غرام',2000,false),
 ('2017031','مردكوش','غرام',500,false),
 ('2017032','كركم','غرام',500,false),
 ('2017033','ميرمية','غرام',500,false),
 ('2017034','زعتر اخضر ( بهارات )','غرام',3,false),
 ('2017035','بهارات مغربية حب','غرام',0.5,false),
 ('2017036','كربونا','غرام',1000,false),
 ('2017037','الو','غرام',5000,false),
 ('2017038','بهارات مشكلة','غرام',3500,false),
 ('2017039','بهارات سجق','غرام',1000,false),
 ('2017040','سماق','غرام',4000,false),
 ('2017041','بهار ابيض ناعم','كغ',4,false),
 ('2017042','محلب ناعم','كغ',1,false),
 ('2017043','كزبرة بودرة','كغ',1.25,false),
 ('2017045','ماجي بودرة','كغ',1,false),
 ('2017046','ماجي مكعبات','مكعب',176,false),
 ('2017048','حلبة حب','كغ',2,false),
 ('2017049','مبيض للحمص','كغ',1,false),
 ('2017050','بهارات نقانق','كغ',2,false),
 ('2017051','قرفة ناعمة','كغ',0.25,false),
 ('2017052','ملون غذاء','قطعة',2,false),
 ('2017053','حلبة بودرة','كغ',1,false),
 ('2018001','صدر دجاج','غرام',1254000,false),
 ('2018002','فخذ دجاج','غرام',10000,false),
 ('2018003','فروج كامل','غرام',67800,false),
 ('2018004','سودة دجاج','غرام',148470,false),
 ('2018005','جوانح','غرام',120000,false),
 ('2018006','كف وردة','كغ',21.479999999999997,false),
 ('2019001','رز طويل (كبسة)','غرام',55000,false),
 ('2019004','فريكة','غرام',11000,false),
 ('2019005','رز مصري','غرام',45000,false),
 ('2019008','فستق حلبي ني','غرام',1000,false),
 ('2019009','برغل احمر ناعم','غرام',60000,false),
 ('2019011','حمص','غرام',203000,false),
 ('2019012','برغل احمر خشن','غرام',12000,false),
 ('2019013','برغل اصفر خشن','غرام',15000,false),
 ('2019014','برغل اصفر ناعم','غرام',77000,false),
 ('2019015','فول حب','كغ',1.5,false),
 ('202001','سكر','غرام',120000,false),
 ('202002','سكر ناعم','غرام',4000,false),
 ('202003','ملح صيني','غرام',6000,false),
 ('202004','ملح ليمون','غرام',10500,false),
 ('202005','ملح','كيس',226,false),
 ('202006','ملح صخري','غرام',2000,false),
 ('2021001','لوز','غرام',1500,false),
 ('2021002','جوز','غرام',20500,false),
 ('2021003','كاجو','غرام',7500,false),
 ('2021004','فستق حلبي محمص','غرام',2000,false),
 ('2021006','لوز مقشور','غرام',5000,false),
 ('2021007','فستق','غرام',91000,false),
 ('2021008','موالح مشكلة','غرام',96000,false),
 ('2021009','جوز الراشد اشقر 5 كغ','كغ',5,false),
 ('2022001','زيت زيتون','غرام',144000,false),
 ('2022002','زيت دوار الشمس','غرام',1034000,false),
 ('2023002','سمن نباتي','غرام',8000,false),
 ('2023004','زبدة قطع','قطعة',5224,false),
 ('2023005','زبدة كغ','غرام',87000,false),
 ('2023006','سمن بقري','كغ',1,false),
 ('2023007','لورباك زبدة 200 غ','قطعة',4,false),
 ('2023008','سمنة مرغريتا','كغ',16,false),
 ('202501','فحم شوي','غرام',1032000,false),
 ('2026001','لوتس بودرة بلجيكي','غرام',8000,false),
 ('2026002','بسكويت سادة','غرام',25000,false),
 ('2026004','بيتشر ابريق 350 مل','قطعة',2,false),
 ('2026005','بيتشر ابريق 1000 مل','قطعة',2,false),
 ('2026006','فورما ستانلس','قطعة',6,false),
 ('2026007','بسكويت لوتس مغلف 50 قطعة','قطعة',7,false),
 ('2026008','مبيض الحموي 800 غرام','كيس',2,false),
 ('2026009','حليب مكثف نسلة 1 كغ','علبة',10,false),
 ('2026010','شوكولا جوفيز سائلة ابيض 4 كغ','سطل',9,false),
 ('2026011','شوكولا جوفيز سائلة غامقة 4 كغ','سطل',12,false),
 ('2026012','حشوة لوتس تركي 5 كغ','سطل',2,false),
 ('2026013','قالب شوكولا جوفيز اسود 3 كغ','قالب',2,false),
 ('2026014','قالب شوكولا جوفيز ابيض 3 كغ','قالب',2,false),
 ('2026015','ماء ورد','غرام',51.00000000000001,false),
 ('2026016','جوز الهند كامل الدسم خشن','غرام',500,false),
 ('2026017','كاكاو فاتح','غرام',2500,false),
 ('2026018','سكر اونو ','ظرف',7200,false),
 ('2026019','خشاف دراق جبل جودي','عبوة',26,false),
 ('2026020','خشاف كرز صغير ','قطعة',12,false),
 ('2026021','خشاف مشمش','قطعة',4,false),
 ('2026022','لب المنغا','قطعة',1,false),
 ('2026023','صوص شوكولا جوفيز','قطعة',24,false),
 ('2026024','صوص فريز جوفيز','قطعة',8,false),
 ('2026025','صوص نعنع جوفيز','قطعة',2,false),
 ('2026026','صوص كاراميل جوفيز','قطعة',4,false),
 ('2026027','صوص عسل جوفيز','قطعة',4,false),
 ('2026028','صوص توت جوفيز','قطعة',1,false),
 ('2026029','صوص موز جوفيز','قطعة',1,false),
 ('2026030','صوص كيوي جوفيز','قطعة',1,false),
 ('2026031','صوص غراندين جوفيز','عبوة',11,false),
 ('2026032','سيروب موكا جوفيز','عبوة',5,false),
 ('2026033','سيروب كاراميل جوفيز','عبوة',5,false),
 ('2026034','سيروب شوكولا جوفيز ','قطعة',4,false),
 ('2026035','سيروب فريز جوفيز','عبوة',7,false),
 ('2026036','سيروب بلو جوفيز','عبوة',2,false),
 ('2026037','سيروب نعنع جوفيز','عبوة',6,false),
 ('2026038','سيروب موهيتو جوفيز','عبوة',1,false),
 ('2026039','سيروب ليمون','قطعة',1,false),
 ('2026040','فستق حلبي مبشور','غرام',6500,false),
 ('2026041','دراجيه شوكولا','غرام',3000,false),
 ('2026042','فارسيل شوكولا اشقر','غرام',3000,false),
 ('2026043','كرانش شوكولا اول','غرام',2000,false),
 ('2026044','اشلميش','غرام',2000,false),
 ('2026045','اصابع سيجار','غرام',13000,false),
 ('2026046','بسكويت اوريو','غرام',11000,false),
 ('2026047','شانتيه بودرة توركات','كيس',10011,false),
 ('2026048','كندر اصابع','قطعة',6,false),
 ('2026049','تويكس','قطعة',7,false),
 ('2026050','شوكولا بابلي','قطعة',6,false),
 ('2026051','كيت كات اصبعين','قطعة',5,false),
 ('2026052','سنيكرز','قطعة',6,false),
 ('2026053','سيروب جوفيرز فروت','قطعة',1,false),
 ('2026054','كريمة بودرة','غرام',10000,false),
 ('2026055','سيروب جوفيرز فانيل','قطعة',5,false),
 ('2026056','بسكويت سيكار','باكيت',6,false),
 ('2026057','حشوة لوتس 6 كغ بالميتو','سطل',6002,false),
 ('2026058','كورنيه بيبي كورن','علبة',1,false),
 ('2026059','سيروب جوفيرز توت','عبوة',3,false),
 ('2026062','لوتس بالميتو سطل','كغ',6,false),
 ('2026063','كيت كات 4 اصابع','قطعة',10,false),
 ('2026064','خشاف انجاص','عبوة',2,false),
 ('2026065','غزل بنات','كغ',8,false),
 ('2026066','مارشميلو','كيس',4,false),
 ('2026067','كستر ظروف','علبة',19,false),
 ('2026068','صوص الديمي جلاس','علبة',1,false),
 ('2027001','بيبسي تنك','عبوة',4125,false),
 ('2027002','مشروب طاقة xxl احمر','عبوة',96,false),
 ('2027003','مشروب طاقة ريد بول','عبوة',72,false),
 ('2027004','كمون كامبو','ظرف',160,false),
 ('2027005','شاي اخضر كامبو','ظرف',100,false),
 ('2027006','شلمون 8 مم','اكياس',10,false),
 ('2027007','شلمون راصور','اكياس',4,false),
 ('2027008','شاي احمر فرط','غرام',2131,false),
 ('2027009','شاي ظروف','ظرف',1890,false),
 ('2027010','بن الحموي موكا احمر مغلف معلب ','غرام',54500,false),
 ('2027011','سيتي كافيه اورجنال','غرام',4500,false),
 ('2027012','سيتي كافيه 3 ب1','غرام',12000,false),
 ('2027013','كيس هوت شوكلت','غرام',14000,false),
 ('2027014','كابتشينو كيس','غرام',9000,false),
 ('2027015','اونو اسبريسو','غرام',6000,false),
 ('2027016','سيتي كافيه ايس كوفي موكا','عبوة',18,false),
 ('2027019','بيرة افاميا','قنينة',40,false),
 ('2027020','شلمون 6 مم','اكياس',8,false),
 ('2027021','عصير فروتي لتر كرتون بريميوم','قطعة',138,false),
 ('2027022','شراب فروتي لتر كرتون','قطعة',408,false),
 ('2027023','ثلج','غرام',857000,false),
 ('2027024','بيرة بيروت','قطعة',1296,false),
 ('2027025','زهورات ظروف','ظرف',160,false),
 ('2027026','عرق 1\2','قطعة',721,false),
 ('2027027','قهوة بريجاوي','غرام',2650,false),
 ('2027028','سفن اب تنك','قطعة',840,false),
 ('2027029','شلمون قياس كبير','كيس',48,false),
 ('2027030','بيرة افاميا صغير','قنينة',1560,false),
 ('2027031','ليكور بلو','قنينة',1,false),
 ('2027032','بابونج','ظرف',60,false),
 ('2027033','عرق لتر','قطعة',60,false),
 ('2027034','فودكا','قطعة',7,false),
 ('2027035','ميراندا تنك','قطعة',72,false),
 ('2027036','بن الحموي اخضر','كغ',0.5,false),
 ('2027037','ويسكي بلاك ليبل','لتر',9,false),
 ('2027038','ويسكي ريد ليبل','لتر',7,false),
 ('2027039','مياه غازية صودا','قنينة',48,false),
 ('2027040','عرق 1/4','قطعة',48,false),
 ('2027041','عرق عنقود نصية','قطعة',75,true),
 ('202801','محارم طاولات','طرد',262,false),
 ('202802','محارم حمامات تنشيف','باكيت',432,false),
 ('202803','نكاشات','علبة',48,false),
 ('202804','محارم القطة','طرد',1,false),
 ('202805','شامبو هامول','قطعة',1,false),
 ('202806','كحول بخاخة','قطعة',1,false),
 ('202807','محارم تواليت','طرد',8,false),
 ('202808','رول حمامات محارم','طرد',11,false),
 ('2029001','بوظة امية فريز','سطل',9,false),
 ('2029002','بوظة امية حليب','سطل',10,false),
 ('2029003','بوظة امية اوريو','سطل',5,false),
 ('2029004','بوظة امية شوكولا','سطل',12,false),
 ('2029005','بوظة امية تشيز كيك فريز','سطل',1,false),
 ('2029006','فريز مجمد','غرام',164000,false),
 ('2029007','بوظة امية فانيل','سطل',1,false),
 ('2031001','فروتي مياه','قطعة',5436,false),
 ('2031002','فروتي مياه صغير','قطعة',600,true),
 ('203201','حلاوة جبن','غرام',10000,false),
 ('203202','معجوقة بالقشطة','غرام',1000,false),
 ('203203','علبة بوظة','غرام',800,false),
 ('2033001','PH','عبوة',2,false),
 ('2033002','كلور','عبوة',7009,false),
 ('2033003','ماء جافيل','عبوة',2,false),
 ('2033004','سوبر جل','عبوة',1,false),
 ('2033005','جيت','عبوة',5,false),
 ('2033006','منظف عام','عبوة',1,false),
 ('2033007','سائل جلي كغ','كغ',341,false),
 ('2033008','فلاش','عبوة',7001,false),
 ('2033009','سيف','كيس',13,false),
 ('2033010','ليف','كيس',2,false),
 ('2033011','صابون سائل ','عبوة',15021,false),
 ('2033012','سائل جلي عبوات','عبوة',43,false),
 ('2033013','معطر','عبوة',7,false),
 ('2033014','ساطع','عبوة',4005,false),
 ('2033015','مساحة ارض','قطعة',10,false),
 ('2033016','فوط ملونة خماسية','قطعة',21,false),
 ('2033017','كلور كغ','كغ',2,false),
 ('2033018','ليتس سائل ملابس','عبوة',3,false),
 ('2033019','كليوباترا فوط','قطعة',5,false),
 ('2033020','تاتش','قطعة',5,false),
 ('2033021','كفوف ماليزي','قطعة',2,false),
 ('2033022','جل غسيل برافو 2 ليتر','قطعة',3,false),
 ('203501','مازوت','مل',1838000,false),
 ('203502','جرة غاز','جرة',52,false)
ON CONFLICT(source_code) DO UPDATE SET material_name=excluded.material_name,base_unit_name=excluded.base_unit_name,reference_quantity=excluded.reference_quantity,requires_review=excluded.requires_review;

-- END GENERATED SOURCE CATALOG SEED.

ALTER TABLE public.purchase_invoices
 ADD COLUMN IF NOT EXISTS is_ameen_legacy_v029 boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_ameen_legacy_v029
 ON public.purchase_invoices(is_ameen_legacy_v029,invoice_date);

CREATE TABLE IF NOT EXISTS public.ameen_purchase_documents_v029 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_document text NOT NULL,
 invoice_date date NOT NULL,
 source_document_hash text NOT NULL CHECK(length(source_document_hash)=32),
 source_file_sha256 text NOT NULL CHECK(length(source_file_sha256)=64),
 invoice_id uuid NOT NULL UNIQUE REFERENCES public.purchase_invoices(id) ON DELETE RESTRICT,
 line_count integer NOT NULL CHECK(line_count>0),
 imported_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_document,invoice_date)
);
ALTER TABLE public.ameen_purchase_documents_v029 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ameen_purchase_documents_v029 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ameen_purchase_documents_v029 TO authenticated;
DROP POLICY IF EXISTS ameen_purchase_doc_owner_v029 ON public.ameen_purchase_documents_v029;
CREATE POLICY ameen_purchase_doc_owner_v029 ON public.ameen_purchase_documents_v029
FOR SELECT TO authenticated USING(public.is_app_owner());

-- Exclude UNVERIFIED HISTORICAL payment status from current supplier liabilities.
-- Does not label unpaid invoices as paid and does not fabricate a cash payment.
CREATE OR REPLACE VIEW public.purchase_invoice_balances AS
 SELECT pi.id,
    pi.supplier_id,
    pi.invoice_number,
    pi.invoice_date,
    pi.due_date,
    pi.currency_code,
    pi.total_original,
    pi.total_base,
    pi.exchange_rate_to_base,
    COALESCE(sum(spa.amount_invoice_currency) FILTER (WHERE sp.status = 'posted'::text), 0::numeric) AS paid_original,
    GREATEST(pi.total_original - COALESCE(sum(spa.amount_invoice_currency) FILTER (WHERE sp.status = 'posted'::text), 0::numeric), 0::numeric) AS balance_original,
        CASE
            WHEN COALESCE(sum(spa.amount_invoice_currency) FILTER (WHERE sp.status = 'posted'::text), 0::numeric) = 0::numeric THEN 'unpaid'::text
            WHEN COALESCE(sum(spa.amount_invoice_currency) FILTER (WHERE sp.status = 'posted'::text), 0::numeric) < pi.total_original THEN 'partial'::text
            ELSE 'paid'::text
        END AS payment_status,
    pi.status AS invoice_status
   FROM purchase_invoices pi
     LEFT JOIN supplier_payment_allocations spa ON spa.invoice_id = pi.id
     LEFT JOIN supplier_payments sp ON sp.id = spa.payment_id
  WHERE coalesce(pi.is_ameen_legacy_v029,false)=false
  GROUP BY pi.id;

-- One-time inventory balance reconciliation after all historical purchase invoices
-- are imported. Stock from purchases alone is NOT the current on-hand balance,
-- because the source also contains sales that are intentionally not re-posted.
CREATE TABLE IF NOT EXISTS public.ameen_kitchen_reconciliation_runs_v029 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reconciled_at timestamptz NOT NULL DEFAULT now(),
 imported_invoice_count integer NOT NULL,
 materials_adjusted integer NOT NULL,
 materials_skipped integer NOT NULL,
 total_adjustment_count integer NOT NULL,
 note text NOT NULL
);
ALTER TABLE public.ameen_kitchen_reconciliation_runs_v029 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ameen_kitchen_reconciliation_runs_v029 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ameen_kitchen_reconciliation_runs_v029 TO authenticated;
DROP POLICY IF EXISTS ameen_kitchen_reconciliation_owner_v029 ON public.ameen_kitchen_reconciliation_runs_v029;
CREATE POLICY ameen_kitchen_reconciliation_owner_v029 ON public.ameen_kitchen_reconciliation_runs_v029
 FOR SELECT TO authenticated USING(public.is_app_owner());

CREATE OR REPLACE FUNCTION public.import_ameen_material_purchases_v029(
 p_sha256 text, p_documents jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_doc jsonb; v_line jsonb; v_source text; v_date date; v_doc_hash text;
 v_invoice uuid; v_supplier uuid; v_unit uuid; v_base_unit uuid;
 v_material uuid; v_existing integer; v_factor numeric; v_qty numeric; v_price numeric;
 v_catalog public.ameen_kitchen_catalog_v029%rowtype;
 v_record public.ameen_purchase_documents_v029%rowtype;
 v_mat_record record; v_source_unit_code text; v_base_unit_code text;
 v_created integer:=0; v_skipped integer:=0; v_new_materials integer:=0;
 v_items integer:=0; v_count integer; v_number text; v_note text;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'AMEEN_PURCHASE_OWNER_ONLY'; END IF;
 IF p_sha256 IS NULL OR p_sha256 <> 'aace3df4694dd214b7537e52fc576628a5d1ed282df08efe348842c96fc8298f' THEN
   RAISE EXCEPTION 'AMEEN_PURCHASE_FILE_NOT_THE_REVIEWED_SOURCE'; END IF;
 IF jsonb_typeof(p_documents)<>'array' THEN RAISE EXCEPTION 'AMEEN_PURCHASE_DOCS_NOT_ARRAY'; END IF;
 v_count=jsonb_array_length(p_documents);
 IF v_count<1 OR v_count>12 THEN RAISE EXCEPTION 'AMEEN_PURCHASE_BATCH_SIZE_1_TO_12'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria:ameen:kitchen:purchases:v029',0));

 SELECT id INTO v_supplier FROM public.suppliers
  WHERE code='AMEEN_LEGACY_UNKNOWN_SOURCE_V029' LIMIT 1;
 IF v_supplier IS NULL THEN
   INSERT INTO public.suppliers(name,code,notes,default_currency_code,is_active)
   VALUES('أرشيف الأمين - مورد غير مذكور','AMEEN_LEGACY_UNKNOWN_SOURCE_V029',
      'مورد تقني لأرشفة فواتير شراء تاريخية؛ لا يمثل دينًا أو دفعًا مثبتًا.','SYP',true)
   RETURNING id INTO v_supplier;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=v_supplier AND is_active=true) THEN
   RAISE EXCEPTION 'AMEEN_LEGACY_SUPPLIER_INACTIVE'; END IF;

 FOR v_doc IN SELECT value FROM jsonb_array_elements(p_documents) LOOP
   v_source=btrim(coalesce(v_doc->>'document',''));
   IF v_source !~ '^شراء:[ ]*[0-9]+$' THEN RAISE EXCEPTION 'AMEEN_BAD_PURCHASE_NUMBER: %',v_source; END IF;
   IF coalesce(v_doc->>'date','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'AMEEN_BAD_PURCHASE_DATE: %',v_source; END IF;
   v_date=(v_doc->>'date')::date;
   IF v_date>current_date+1 OR v_date<date '2000-01-01' THEN RAISE EXCEPTION 'AMEEN_DATE_OUT_OF_RANGE'; END IF;
   IF jsonb_typeof(v_doc->'lines')<>'array' OR jsonb_array_length(v_doc->'lines') NOT BETWEEN 1 AND 250 THEN
     RAISE EXCEPTION 'AMEEN_BAD_PURCHASE_LINE_COUNT: %',v_source; END IF;
   v_doc_hash=md5(v_doc::text);
   SELECT * INTO v_record FROM public.ameen_purchase_documents_v029
     WHERE source_document=v_source AND invoice_date=v_date FOR UPDATE;
   IF FOUND THEN
      IF v_record.source_document_hash<>v_doc_hash THEN
        RAISE EXCEPTION 'AMEEN_SOURCE_INVOICE_CHANGED_REVIEW_REQUIRED: % / %',v_source,v_date;
      END IF;
      v_skipped:=v_skipped+1;CONTINUE;
   END IF;

   -- Source contains only a DATE, never a real clock time. Noon Syria time is
   -- a technical placeholder and not a claim about actual purchase time.
   v_invoice:=public.create_purchase_invoice(v_supplier,'SYP',v_source,v_date,
       ((v_date::timestamp + interval '12 hours') AT TIME ZONE 'Asia/Damascus'),
       'import','مرجع شراء تاريخي من حركة مادة1؛ المورد والدفع غير معروفين؛ لا تدخل ضمن الديون',NULL,NULL);
   UPDATE public.purchase_invoices SET is_ameen_legacy_v029=true WHERE id=v_invoice;

   FOR v_line IN SELECT value FROM jsonb_array_elements(v_doc->'lines') LOOP
     IF coalesce(v_line->>'code','') !~ '^2[0-9]{4,10}$' THEN
       RAISE EXCEPTION 'AMEEN_INVALID_KITCHEN_MATERIAL_CODE: %',v_source; END IF;
     SELECT * INTO v_catalog FROM public.ameen_kitchen_catalog_v029
       WHERE source_code=(v_line->>'code');
     IF NOT FOUND OR v_catalog.requires_review THEN
       RAISE EXCEPTION 'AMEEN_MATERIAL_NEEDS_REVIEW: %',v_line->>'code'; END IF;
     IF public.recipe_key_normalize_v027(v_catalog.material_name)
        <>public.recipe_key_normalize_v027(v_line->>'name') THEN
       RAISE EXCEPTION 'AMEEN_MATERIAL_CODE_NAME_MISMATCH: %',v_line->>'code'; END IF;
     IF coalesce(v_line->>'quantity','') !~ '^[0-9]+([.][0-9]+)?$'
        OR coalesce(v_line->>'unitPrice','') !~ '^[0-9]+([.][0-9]+)?$' THEN
       RAISE EXCEPTION 'AMEEN_BAD_PURCHASE_QUANTITY_PRICE: %',v_line->>'name'; END IF;
     v_qty=(v_line->>'quantity')::numeric;
     v_price=(v_line->>'unitPrice')::numeric;
     IF v_qty<=0 OR v_qty>100000000 OR v_price<=0 OR v_price>100000000 THEN
       RAISE EXCEPTION 'AMEEN_PURCHASE_AMOUNT_OUT_OF_RANGE: %',v_line->>'name'; END IF;
     IF length(coalesce(v_line->>'sourceUnit',''))>90 OR btrim(coalesce(v_line->>'sourceUnit',''))='' THEN
       RAISE EXCEPTION 'AMEEN_PURCHASE_UNIT_MISSING'; END IF;
     v_unit:=public.ameen_unit_v024(v_line->>'sourceUnit');
     v_base_unit:=public.ameen_unit_v024(v_catalog.base_unit_name);
     IF v_unit IS NULL OR v_base_unit IS NULL THEN RAISE EXCEPTION 'AMEEN_UNIT_MISSING'; END IF;
     SELECT upper(code) INTO v_source_unit_code FROM public.units WHERE id=v_unit;
     SELECT upper(code) INTO v_base_unit_code FROM public.units WHERE id=v_base_unit;
     v_factor:=CASE WHEN v_unit=v_base_unit THEN 1
       WHEN v_source_unit_code='KG' AND v_base_unit_code='G' THEN 1000
       WHEN v_source_unit_code='G' AND v_base_unit_code='KG' THEN 0.001
       WHEN v_source_unit_code='L' AND v_base_unit_code='ML' THEN 1000
       WHEN v_source_unit_code='ML' AND v_base_unit_code='L' THEN 0.001
       ELSE NULL END;
     IF v_factor IS NULL THEN
       RAISE EXCEPTION 'AMEEN_UNIT_CONVERSION_NOT_PROVEN: % (% / %)',
         v_line->>'name',v_line->>'sourceUnit',v_catalog.base_unit_name; END IF;

     SELECT count(*),(array_agg(m.id))[1] INTO v_existing,v_material FROM public.materials m
      WHERE public.recipe_key_normalize_v027(m.name)=public.recipe_key_normalize_v027(v_catalog.material_name);
     IF v_existing>1 THEN RAISE EXCEPTION 'AMEEN_DUPLICATE_MATERIAL_NAME: %',v_catalog.material_name; END IF;
     IF v_existing=0 THEN
       INSERT INTO public.materials(name,code,base_unit_id,notes)
       VALUES(v_catalog.material_name,'AM-SRC-'||v_catalog.source_code,v_base_unit,
           'مصدر المادة: الأمين، مستودع المطبخ، رقم '||v_catalog.source_code)
       RETURNING id INTO v_material;
       v_new_materials:=v_new_materials+1;
     ELSE
       IF NOT EXISTS(SELECT 1 FROM public.materials m
         WHERE m.id=v_material AND m.base_unit_id=v_base_unit AND m.is_active=true) THEN
         RAISE EXCEPTION 'AMEEN_EXISTING_MATERIAL_UNIT_DIFFERS: %',v_catalog.material_name; END IF;
     END IF;
     IF v_factor<>1 THEN
       INSERT INTO public.material_units(material_id,unit_id,quantity_in_base,
          is_default_purchase_unit,is_purchase_unit,is_recipe_unit)
       VALUES(v_material,v_unit,v_factor,false,true,true)
       ON CONFLICT(material_id,unit_id) DO NOTHING;
       IF NOT EXISTS(SELECT 1 FROM public.material_units mu
          WHERE mu.material_id=v_material AND mu.unit_id=v_unit AND mu.quantity_in_base=v_factor) THEN
         RAISE EXCEPTION 'AMEEN_EXISTING_CONVERSION_DIFFERS: %',v_catalog.material_name; END IF;
     END IF;
     PERFORM public.add_purchase_invoice_item(v_invoice,v_material,v_unit,v_qty,v_price,0,NULL,
       'سطر الأمين رقم '||coalesce(v_line->>'sourceRow','?'));
     v_items:=v_items+1;
   END LOOP;
   -- IMPORTANT: posting creates historical PURCHASE movements and latest-purchase snapshots.
   PERFORM public.post_purchase_invoice(v_invoice);
   INSERT INTO public.ameen_purchase_documents_v029
      (source_document,invoice_date,source_document_hash,source_file_sha256,invoice_id,line_count)
   VALUES(v_source,v_date,v_doc_hash,p_sha256,v_invoice,jsonb_array_length(v_doc->'lines'));
   v_created:=v_created+1;
 END LOOP;
 INSERT INTO public.ameen_warehouses_v024(name) VALUES('مستودع المطبخ') ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('createdInvoices',v_created,'duplicateInvoices',v_skipped,
   'purchaseItemsCreated',v_items,'materialsCreated',v_new_materials,
   'historicalOnly',true,'paymentsCreated',0);
END;
$$;
REVOKE ALL ON FUNCTION public.import_ameen_material_purchases_v029(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.import_ameen_material_purchases_v029(text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.import_ameen_material_purchases_v029(text,jsonb) IS
 'Owner only, idempotent dated historical kitchen invoices; unknown payment state excluded from supplier liabilities.';

-- Kitchen stock is qualified by REAL published purchase invoices, not the excluded
-- kitchen rows in the inventory source report.
CREATE OR REPLACE FUNCTION public.reconcile_ameen_kitchen_stock_v029(p_confirmation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_run uuid; v_record record; v_mat record; v_delta numeric;
 v_matched int:=0; v_skipped int:=0; v_adjusted int:=0;
 v_invoices int; v_missing int; v_abs_balance numeric:=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'AMEEN_RECONCILE_OWNER_ONLY'; END IF;
 IF p_confirmation IS DISTINCT FROM 'RECONCILE_MARIA_KITCHEN_V029_NOW' THEN
  RAISE EXCEPTION 'AMEEN_RECONCILE_CONFIRMATION_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria:ameen:kitchen:purchases:v029',0));
 SELECT count(*) INTO v_invoices FROM public.ameen_purchase_documents_v029;
 IF v_invoices<>538 THEN
   RAISE EXCEPTION 'AMEEN_RECONCILE_REQUIRES_538_POSTED_SOURCE_INVOICES: found %',v_invoices;
 END IF;
 SELECT count(*) INTO v_missing
 FROM public.ameen_purchase_documents_v029 doc
 JOIN public.purchase_invoices pi ON pi.id=doc.invoice_id
 WHERE pi.status<>'posted' OR pi.is_ameen_legacy_v029 IS DISTINCT FROM true
 OR pi.is_voided IS TRUE;
 IF v_missing>0 THEN RAISE EXCEPTION 'AMEEN_RECONCILE_REQUIRES_ALL_POSTED_INVOICES'; END IF;
 IF EXISTS(SELECT 1 FROM public.ameen_kitchen_reconciliation_runs_v029) THEN
  RAISE EXCEPTION 'AMEEN_KITCHEN_ALREADY_RECONCILED_USE_AUDIT_REVIEW';
 END IF;
 INSERT INTO public.ameen_kitchen_reconciliation_runs_v029
  (imported_invoice_count,materials_adjusted,materials_skipped,total_adjustment_count,note)
 VALUES(v_invoices,0,0,0,'مطابقة رصيد المطبخ مع تقرير جرد المواد6؛ لا تعيد احتساب مبيعات الأمين التاريخية')
 RETURNING id INTO v_run;
 FOR v_record IN SELECT * FROM public.ameen_kitchen_catalog_v029 ORDER BY source_code LOOP
  -- The exported Dibs Rumman shows 30,131.5 KG against 30.1315 L;
  -- no physical conversion between kilograms and litres has been verified.
  IF v_record.requires_review OR v_record.source_code='2015011' THEN
    v_skipped:=v_skipped+1; CONTINUE; END IF;
  SELECT m.id,m.current_stock_base,m.last_purchase_unit_cost_base,
         m.base_unit_id,u.name AS unit_name INTO v_mat
  FROM public.materials m JOIN public.units u ON u.id=m.base_unit_id
  WHERE m.code='AM-SRC-'||v_record.source_code AND m.is_active=true;
  IF NOT FOUND THEN
     SELECT m.id,m.current_stock_base,m.last_purchase_unit_cost_base,
        m.base_unit_id,u.name AS unit_name INTO v_mat
     FROM public.materials m JOIN public.units u ON u.id=m.base_unit_id
     WHERE public.recipe_key_normalize_v027(m.name)=public.recipe_key_normalize_v027(v_record.material_name)
       AND m.is_active=true LIMIT 1;
  END IF;
  IF NOT FOUND THEN v_skipped:=v_skipped+1; CONTINUE; END IF;
  IF v_mat.last_purchase_unit_cost_base IS NULL OR v_mat.last_purchase_unit_cost_base<=0
    OR NOT public.recipe_unit_matches_v028(v_mat.base_unit_id,v_record.base_unit_name)
    OR NOT EXISTS (
      SELECT 1 FROM public.purchase_invoice_items pii
      JOIN public.ameen_purchase_documents_v029 docs ON docs.invoice_id=pii.invoice_id
      WHERE pii.material_id=v_mat.id
    )
  THEN v_skipped:=v_skipped+1; CONTINUE; END IF;
  v_matched:=v_matched+1;
  v_delta:=round(v_record.reference_quantity-v_mat.current_stock_base,6);
  IF v_delta=0 THEN CONTINUE; END IF;
  PERFORM public.record_inventory_movement(v_mat.id,
    CASE WHEN v_delta>0 THEN 'adjustment_in' ELSE 'adjustment_out' END,
    v_delta,v_mat.last_purchase_unit_cost_base,now(),
    'ameen_kitchen_stock_reconciliation_v029',v_run,NULL,
    'تسوية مخزون تاريخي إلى الجرد الفعلي، وليس بيعًا أو شراءً أو هدرًا مثبتًا');
  v_adjusted:=v_adjusted+1;
  v_abs_balance:=v_abs_balance+abs(v_delta);
 END LOOP;
 IF v_matched<250 THEN
  RAISE EXCEPTION 'AMEEN_RECONCILE_TOO_FEW_PRICED_MATCHES: %',v_matched;
 END IF;
 UPDATE public.ameen_kitchen_reconciliation_runs_v029
 SET materials_adjusted=v_adjusted,materials_skipped=v_skipped,total_adjustment_count=v_adjusted
 WHERE id=v_run;
 RETURN jsonb_build_object('matchedPricedMaterials',v_matched,
 'adjustedMaterials',v_adjusted,'unresolvedMaterials',v_skipped,
 'sumAbsoluteCorrectionInMixedBaseUnits',v_abs_balance,
 'note','The differences are balance corrections, not reconstructed historical sales.');
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_ameen_kitchen_stock_v029(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_ameen_kitchen_stock_v029(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ameen_kitchen_material_status_v029()
RETURNS TABLE(core_entity_id uuid,kind text,warehouse text,quantity_base numeric,review_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT DISTINCT m.id, 'material'::text, 'مستودع المطبخ'::text, m.current_stock_base,
        NULL::text
 FROM public.materials m
 JOIN public.purchase_invoice_items pii ON pii.material_id=m.id
 JOIN public.purchase_invoices pi ON pi.id=pii.invoice_id
 JOIN public.ameen_purchase_documents_v029 doc ON doc.invoice_id=pi.id
 WHERE public.is_app_owner() AND m.current_stock_base>0
   AND m.last_purchase_unit_cost_base>0 AND pi.is_ameen_legacy_v029=true
   AND pi.status='posted' AND coalesce(pi.is_voided,false)=false;
$$;
REVOKE ALL ON FUNCTION public.ameen_kitchen_material_status_v029() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ameen_kitchen_material_status_v029() TO authenticated;

-- Server must reject the old inventory's kitchen material rows even when called
-- directly with forged JSON; they come exclusively from posted source purchases.
CREATE OR REPLACE FUNCTION public.import_ameen_v029(
 p_kind text,p_filename text,p_sha256 text,p_records jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_rec jsonb; v_allowed jsonb:='[]'::jsonb;
 v_qty numeric; v_price numeric; v_accept boolean;
 v_name text; v_wh text; v_kind text; v_run uuid; v_result jsonb;
 v_total integer; v_kept integer:=0; v_record record; v_price_base numeric;
 v_applied integer:=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF jsonb_typeof(p_records)<>'array' THEN RAISE EXCEPTION 'V029_EXPECT_RECORD_ARRAY'; END IF;
 v_total:=jsonb_array_length(p_records);
 IF v_total<1 OR v_total>5000 THEN RAISE EXCEPTION 'V029_RECORD_COUNT_INVALID'; END IF;
 IF p_kind<>'inventory' THEN
   RETURN public.import_ameen_v024(p_kind,p_filename,p_sha256,p_records);
 END IF;
 FOR v_rec IN SELECT value FROM jsonb_array_elements(p_records) LOOP
   v_kind:=v_rec->>'kind';v_name:=btrim(coalesce(v_rec->>'name',''));
   v_wh:=btrim(coalesce(v_rec->>'warehouse',''));
   IF coalesce(v_rec->>'quantity','') !~ '^-?[0-9]+([.][0-9]+)?$'
      OR (v_rec->>'price' IS NOT NULL AND (v_rec->>'price') !~ '^-?[0-9]+([.][0-9]+)?$')
   THEN RAISE EXCEPTION 'V029_BAD_QUANTITY_OR_PRICE: %',v_name; END IF;
   v_qty:=(v_rec->>'quantity')::numeric;
   v_price:=coalesce((v_rec->>'price')::numeric,0);
   v_accept:=false;
   IF v_kind='material' AND public.recipe_key_normalize_v027(v_wh)=public.recipe_key_normalize_v027('مستودع المطبخ') THEN
     v_accept:=false;
   ELSIF v_kind='material' THEN
     IF (SELECT count(*) FROM public.materials m WHERE lower(btrim(m.name))=lower(v_name))>1 THEN
       RAISE EXCEPTION 'V029_DUPLICATE_MATERIAL_NAME_REVIEW_REQUIRED: %',v_name;
     END IF;
     v_accept:=v_wh<>'' AND v_qty>0 AND
       (v_price>0 OR EXISTS(
          SELECT 1 FROM public.materials m WHERE lower(btrim(m.name))=lower(v_name)
            AND m.last_purchase_unit_cost_base>0));
   ELSIF v_kind='menu' THEN
     v_accept:=v_price>0;
   ELSIF v_kind='asset' THEN
     v_accept:=v_wh<>'' AND v_qty>0;
   END IF;
   IF v_accept THEN
     v_allowed:=v_allowed||jsonb_build_array(v_rec);v_kept:=v_kept+1;
   END IF;
 END LOOP;
 IF v_kept=0 THEN RAISE EXCEPTION 'V029_NO_ELIGIBLE_RECORDS'; END IF;
 -- Existing v0.24 implementation atomically creates catalog rows and stock movements.
 v_result:=public.import_ameen_v024(p_kind,p_filename,p_sha256,v_allowed);
 IF coalesce((v_result->>'duplicateFile')::boolean,false) THEN
   RETURN v_result||jsonb_build_object('v029Accepted',v_kept,'v029Rejected',v_total-v_kept);
 END IF;
 v_run:=(v_result->>'runId')::uuid;
 -- The Excel source_price is per EXCEL inventory unit. Convert to BASE unit
 -- using the quantity conversion already validated by the original importer.
 -- Only fill unknown reference costs; never overwrite a genuine previous price.
 FOR v_record IN
   SELECT DISTINCT ON (i.core_entity_id) i.core_entity_id AS material_id,
     i.source_price,i.quantity_original,i.quantity_base,i.warehouse,i.unit_name
   FROM public.ameen_inventory_rows_v024 i
   WHERE i.last_run_id=v_run AND i.kind='material'
    AND i.source_price>0 AND i.quantity_original>0 AND i.quantity_base>0
    AND i.review_reason IS NULL AND nullif(btrim(i.warehouse),'') IS NOT NULL
   ORDER BY i.core_entity_id,i.source_key
 LOOP
   v_price_base:=round(v_record.source_price * v_record.quantity_original / v_record.quantity_base,8);
   IF v_price_base<=0 THEN CONTINUE; END IF;
   UPDATE public.materials SET last_purchase_unit_cost_base=v_price_base
   WHERE id=v_record.material_id
      AND (last_purchase_unit_cost_base IS NULL OR last_purchase_unit_cost_base<=0);
   IF FOUND THEN
     v_applied:=v_applied+1;
     INSERT INTO public.ameen_material_cost_sources_v029
       (material_id,run_id,source_price,price_per_base_unit,source_warehouse,source_unit)
     VALUES(v_record.material_id,v_run,v_record.source_price,v_price_base,
       v_record.warehouse,coalesce(v_record.unit_name,''))
     ON CONFLICT(material_id) DO NOTHING;
   END IF;
 END LOOP;
 RETURN v_result||jsonb_build_object('v029Accepted',v_kept,'v029Rejected',v_total-v_kept,
   'v029MaterialPricesSetFromExcel',v_applied);
END;
$$;

-- Server recipe validator now considers imported kitchen historical purchases
-- an auditable valid warehouse source (not a second opening-balance import).
CREATE OR REPLACE FUNCTION public.import_menu_recipes_v029(
  p_sha256 text,
  p_recipes jsonb,
  p_lines jsonb,
  p_replace_existing boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_recipe jsonb; v_line jsonb; v_key text; v_name text; v_material_name text;
  v_unit_name text; v_menu uuid; v_mat uuid; v_unit uuid; v_qty numeric;
  v_count integer; v_existing_count integer; v_created integer:=0;
  v_inserted integer:=0; v_updated integer:=0; v_unchanged integer:=0;
  v_removed integer:=0; v_run uuid; v_summary jsonb; v_row record;
  v_distinct_materials integer; v_priced_materials integer;
  v_missing_materials integer; v_covered_recipes integer;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'RECIPES_ACCESS_DENIED'; END IF;
 IF p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'RECIPES_INVALID_SHA256'; END IF;
 IF jsonb_typeof(p_recipes)<>'array' OR jsonb_typeof(p_lines)<>'array' THEN
   RAISE EXCEPTION 'RECIPES_EXPECT_ARRAYS'; END IF;
 IF jsonb_array_length(p_recipes) NOT BETWEEN 1 AND 75 THEN RAISE EXCEPTION 'RECIPES_V029_EXPECT_1_TO_75_ELIGIBLE_MENU_ITEMS'; END IF;
 IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'RECIPES_INVALID_LINES'; END IF;

 -- Same lock key used by v0.27: never interleave two full-file imports.
 PERFORM pg_advisory_xact_lock(hashtext('maria_recipes_v027_atomic'));
 CREATE TEMP TABLE IF NOT EXISTS pg_temp.recipe_targets_v029 (
   recipe_key text PRIMARY KEY, menu_item_id uuid NOT NULL UNIQUE,
   menu_name text NOT NULL
 ) ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS pg_temp.recipe_lines_v029 (
   recipe_key text NOT NULL, menu_item_id uuid NOT NULL, material_id uuid NOT NULL,
   quantity_base numeric NOT NULL CHECK(quantity_base>0)
 ) ON COMMIT DROP;
 TRUNCATE TABLE pg_temp.recipe_targets_v029,pg_temp.recipe_lines_v029;

 FOR v_recipe IN SELECT value FROM jsonb_array_elements(p_recipes) LOOP
   v_key:=btrim(coalesce(v_recipe->>'key',''));
   v_name:=btrim(coalesce(v_recipe->>'menuName',''));
   IF length(v_key) NOT BETWEEN 2 AND 80 OR length(v_name) NOT BETWEEN 2 AND 250 THEN
      RAISE EXCEPTION 'RECIPE_KEY_OR_NAME_MISSING'; END IF;
   SELECT count(*),(array_agg(mi.id))[1] INTO v_count,v_menu
     FROM public.menu_items mi
     WHERE public.recipe_key_normalize_v027(mi.name)=public.recipe_key_normalize_v027(v_name);
   IF v_count<>1 THEN RAISE EXCEPTION 'MENU_ITEM_NOT_UNIQUE_OR_MISSING: %',v_name; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.menu_items mi WHERE mi.id=v_menu AND mi.manual_price_original>0) THEN
      RAISE EXCEPTION 'RECIPE_V029_MENU_WITHOUT_POSITIVE_SELLING_PRICE: %',v_name; END IF;
   INSERT INTO pg_temp.recipe_targets_v029(recipe_key,menu_item_id,menu_name)
     VALUES(v_key,v_menu,v_name);
 END LOOP;

 FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
   v_key:=btrim(coalesce(v_line->>'recipeKey',''));
   SELECT t.menu_item_id INTO v_menu FROM pg_temp.recipe_targets_v029 t WHERE t.recipe_key=v_key;
   IF v_menu IS NULL THEN RAISE EXCEPTION 'RECIPE_LINE_UNKNOWN_KEY: %',v_key; END IF;
   v_material_name:=btrim(coalesce(v_line->>'materialName',''));
   v_unit_name:=btrim(coalesce(v_line->>'baseUnit',''));
   IF length(v_material_name) NOT BETWEEN 2 AND 250 OR length(v_unit_name) NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'RECIPE_MATERIAL_OR_UNIT_MISSING: %',v_key; END IF;
   IF coalesce(v_line->>'quantityBase','') !~ '^([0-9]+)([.][0-9]+)?$' THEN
      RAISE EXCEPTION 'RECIPE_INVALID_QUANTITY: %/%',v_key,v_material_name; END IF;
   v_qty:=(v_line->>'quantityBase')::numeric;
   IF v_qty<=0 OR v_qty>10000000 THEN RAISE EXCEPTION 'RECIPE_QUANTITY_OUT_OF_RANGE: %',v_material_name; END IF;
   SELECT count(*),(array_agg(m.id))[1] INTO v_count,v_mat
      FROM public.materials m
      WHERE public.recipe_key_normalize_v027(m.name)=public.recipe_key_normalize_v027(v_material_name);
   IF v_count>1 THEN RAISE EXCEPTION 'RECIPE_MATERIAL_DUPLICATE_CATALOG: %',v_material_name; END IF;
   -- NEVER create a material from a recipe. v0.29 only accepts catalog materials
   -- with a positive physical stock, positive cost and a valid imported warehouse.
   IF v_count=0 THEN RAISE EXCEPTION 'RECIPE_V029_MATERIAL_MISSING: %',v_material_name; END IF;
   SELECT m.base_unit_id INTO v_unit FROM public.materials m WHERE m.id=v_mat;
   IF NOT public.recipe_unit_matches_v028(v_unit,v_unit_name) THEN
      RAISE EXCEPTION 'RECIPE_V029_UNIT_MISMATCH: % / %',v_material_name,v_unit_name; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.materials m WHERE m.id=v_mat
      AND m.current_stock_base>0 AND m.last_purchase_unit_cost_base>0) THEN
      RAISE EXCEPTION 'RECIPE_V029_MATERIAL_WITHOUT_STOCK_OR_PRICE: %',v_material_name; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.ameen_inventory_rows_v024 inv
      WHERE inv.core_entity_id=v_mat AND inv.kind='material'
        AND nullif(btrim(inv.warehouse),'') IS NOT NULL
        AND inv.quantity_base>0 AND inv.review_reason IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM public.purchase_invoice_items pii
        JOIN public.purchase_invoices pi ON pi.id=pii.invoice_id
        JOIN public.ameen_purchase_documents_v029 d ON d.invoice_id=pi.id
        WHERE pii.material_id=v_mat AND pi.is_ameen_legacy_v029=true
          AND pi.status='posted' AND coalesce(pi.is_voided,false)=false)
   THEN RAISE EXCEPTION 'RECIPE_V029_MATERIAL_WITHOUT_VALID_WAREHOUSE: %',v_material_name; END IF;
   INSERT INTO pg_temp.recipe_lines_v029(recipe_key,menu_item_id,material_id,quantity_base)
      VALUES(v_key,v_menu,v_mat,v_qty);
 END LOOP;

 IF EXISTS(SELECT 1 FROM pg_temp.recipe_targets_v029 t WHERE NOT EXISTS(
     SELECT 1 FROM pg_temp.recipe_lines_v029 x WHERE x.recipe_key=t.recipe_key))
 THEN RAISE EXCEPTION 'RECIPE_MISSING_ALL_MATERIALS'; END IF;
 SELECT count(*) INTO v_existing_count FROM public.menu_item_recipe_items ri
    WHERE ri.menu_item_id IN (SELECT t.menu_item_id FROM pg_temp.recipe_targets_v029 t);
 IF v_existing_count>0 AND NOT p_replace_existing THEN
    RAISE EXCEPTION 'RECIPE_EXISTING_COMPONENTS_REQUIRE_CONFIRMATION: %',v_existing_count; END IF;

 CREATE TEMP TABLE IF NOT EXISTS pg_temp.recipe_desired_v029 (
   menu_item_id uuid NOT NULL,
   material_id uuid NOT NULL,
   base_unit_id uuid NOT NULL,
   qty numeric NOT NULL,
   PRIMARY KEY(menu_item_id,material_id)
 ) ON COMMIT DROP;
 TRUNCATE TABLE pg_temp.recipe_desired_v029;
 INSERT INTO pg_temp.recipe_desired_v029(menu_item_id,material_id,base_unit_id,qty)
 SELECT x.menu_item_id,x.material_id,m.base_unit_id,round(sum(x.quantity_base),8)
   FROM pg_temp.recipe_lines_v029 x JOIN public.materials m ON m.id=x.material_id
  GROUP BY x.menu_item_id,x.material_id,m.base_unit_id;
 IF EXISTS(SELECT 1 FROM pg_temp.recipe_desired_v029 WHERE qty<=0)
 THEN RAISE EXCEPTION 'RECIPE_ROUNDED_TO_ZERO'; END IF;

 -- Save run + state BEFORE modifying rows, in the same atomic transaction.
 INSERT INTO public.recipe_import_runs_v028(file_sha256,recipe_count,material_line_count)
 VALUES(p_sha256,(SELECT count(*) FROM pg_temp.recipe_targets_v029),
        (SELECT count(*) FROM pg_temp.recipe_lines_v029))
 RETURNING id INTO v_run;
 INSERT INTO public.recipe_import_backups_v028(run_id,menu_item_id,original_recipe)
 SELECT v_run,t.menu_item_id,
   coalesce((SELECT jsonb_agg(to_jsonb(ri) ORDER BY ri.id)
     FROM public.menu_item_recipe_items ri WHERE ri.menu_item_id=t.menu_item_id),'[]'::jsonb)
 FROM pg_temp.recipe_targets_v029 t;

 -- Preserve row IDs when ingredient and quantity are unchanged. New/changed rows
 -- pass through the existing owner-only v0.7 validated recipe writer.
 FOR v_row IN
   SELECT d.menu_item_id,d.material_id,d.base_unit_id,d.qty,
       ri.id AS existing_id,ri.quantity_base AS existing_qty,
       ri.input_quantity AS existing_input_qty,ri.input_unit_id AS existing_input_unit_id
   FROM pg_temp.recipe_desired_v029 d
   LEFT JOIN public.menu_item_recipe_items ri
      ON ri.menu_item_id=d.menu_item_id AND ri.material_id=d.material_id
 LOOP
   IF v_row.existing_id IS NULL THEN
      PERFORM public.save_menu_recipe_item_v07(v_row.menu_item_id,v_row.material_id,
                 v_row.base_unit_id,v_row.qty,NULL);
      v_inserted:=v_inserted+1;
   ELSIF v_row.existing_qty IS DISTINCT FROM v_row.qty
      OR v_row.existing_input_qty IS DISTINCT FROM v_row.qty
      OR v_row.existing_input_unit_id IS DISTINCT FROM v_row.base_unit_id THEN
      PERFORM public.save_menu_recipe_item_v07(v_row.menu_item_id,v_row.material_id,
                 v_row.base_unit_id,v_row.qty,v_row.existing_id);
      v_updated:=v_updated+1;
   ELSE
      v_unchanged:=v_unchanged+1;
   END IF;
 END LOOP;

 -- Delete ONLY ingredients absent from the new approved file, after backup and confirmation.
 DELETE FROM public.menu_item_recipe_items ri
  WHERE ri.menu_item_id IN (SELECT t.menu_item_id FROM pg_temp.recipe_targets_v029 t)
    AND NOT EXISTS(SELECT 1 FROM pg_temp.recipe_desired_v029 d
      WHERE d.menu_item_id=ri.menu_item_id AND d.material_id=ri.material_id);
 GET DIAGNOSTICS v_removed = ROW_COUNT;

 -- Price is ALWAYS read live from matched materials.last_purchase_unit_cost_base.
 -- Never update materials.last_purchase_unit_cost_base from the Excel's zero prices.
 SELECT count(*),count(*) FILTER(WHERE m.last_purchase_unit_cost_base>0),
   count(*) FILTER(WHERE (m.last_purchase_unit_cost_base IS NULL OR m.last_purchase_unit_cost_base<=0))
 INTO v_distinct_materials,v_priced_materials,v_missing_materials
 FROM public.materials m WHERE m.id IN (SELECT DISTINCT d.material_id FROM pg_temp.recipe_desired_v029 d);
 SELECT count(*) INTO v_covered_recipes
 FROM pg_temp.recipe_targets_v029 t WHERE NOT EXISTS(
   SELECT 1 FROM pg_temp.recipe_desired_v029 d JOIN public.materials m ON m.id=d.material_id
   WHERE d.menu_item_id=t.menu_item_id AND (m.last_purchase_unit_cost_base IS NULL OR m.last_purchase_unit_cost_base<=0)
 );

 v_summary:=jsonb_build_object(
   'recipesImported',(SELECT count(*) FROM pg_temp.recipe_targets_v029),'sourceLines',(SELECT count(*) FROM pg_temp.recipe_lines_v029),
   'matchedMaterials',v_distinct_materials,'pricedMaterials',v_priced_materials,
   'missingPriceMaterials',v_missing_materials,'recipesFullyPriced',v_covered_recipes,
   'materialsCreated',v_created,'linesInserted',v_inserted,'linesUpdated',v_updated,
   'linesRemoved',v_removed,'linesUnchanged',v_unchanged,'duplicateFile',false,
   'note','v0.29: only entirely priced and stocked recipes in a physical warehouse, sale price >0, no unpriced material creation.'
 );
 UPDATE public.recipe_import_runs_v028 SET summary=v_summary WHERE id=v_run;
 RETURN v_summary;
END;
$$;

-- Prevent accidental UI/API voids from silently reversing an archive import.
CREATE OR REPLACE FUNCTION public.guard_ameen_legacy_purchase_v029()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.is_ameen_legacy_v029 AND OLD.status='posted' AND (
   NEW.status IS DISTINCT FROM OLD.status OR
   NEW.is_voided IS DISTINCT FROM OLD.is_voided OR
   NEW.total_original IS DISTINCT FROM OLD.total_original OR
   NEW.invoice_date IS DISTINCT FROM OLD.invoice_date OR
   NEW.occurred_at IS DISTINCT FROM OLD.occurred_at) THEN
   RAISE EXCEPTION 'AMEEN_HISTORICAL_PURCHASE_IMMUTABLE_REVIEW_REQUIRED';
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_ameen_legacy_purchase_v029_trigger ON public.purchase_invoices;
CREATE TRIGGER guard_ameen_legacy_purchase_v029_trigger BEFORE UPDATE ON public.purchase_invoices
 FOR EACH ROW EXECUTE FUNCTION public.guard_ameen_legacy_purchase_v029();

COMMIT;
