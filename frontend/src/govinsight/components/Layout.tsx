import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Scale, FileText, Map, Building2, ChevronDown, Microscope, Briefcase, Activity,
  ChevronRight, Check, Printer, MousePointerClick
} from 'lucide-react';
import { EntityProfile } from '../types';
import { buildRegionTree, loadEntityData } from '../data';
import { fetchOrgs } from '../api';

interface LayoutProps {
  children: React.ReactNode;
}

export const EntityContext = React.createContext<{
  entity: EntityProfile | null;
  setEntity: (e: EntityProfile) => void;
  isLoading: boolean;
}>({
  entity: null,
  setEntity: () => { },
  isLoading: false
});

// Helper to separate Geographic units (Districts, Streets, Towns) from Functional Departments
const partitionChildren = (children: EntityProfile[]) => {
  const geo: EntityProfile[] = [];
  const depts: EntityProfile[] = [];

  // Suffixes that indicate a Geographic/Administrative Area
  const geoSuffixes = ['区', '县', '市', '街道', '镇', '乡', '办事处', '园区', '新区', '开发区'];

  children.forEach(c => {
    // Exact match suffix or special logic
    const isGeo = geoSuffixes.some(suffix => c.name.endsWith(suffix));
    if (isGeo) {
      geo.push(c);
    } else {
      depts.push(c);
    }
  });
  return { geo, depts };
};

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();

  const [regionTree, setRegionTree] = useState<EntityProfile[]>([]);
  const [currentEntity, setCurrentEntity] = useState<EntityProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitLoading, setIsInitLoading] = useState(true);

  // Cascader State
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [level1, setLevel1] = useState<EntityProfile | null>(null); // Province
  const [level2, setLevel2] = useState<EntityProfile | null>(null); // City
  const [level3, setLevel3] = useState<EntityProfile | null>(null); // District
  const menuRef = useRef<HTMLDivElement>(null);

  // Initial Load
  useEffect(() => {
    const init = async () => {
      setIsInitLoading(true);
      try {
        const rawOrgs = await fetchOrgs();
        const orgs = rawOrgs.filter(o => o.name && !o.name.includes('Test') && !o.name.includes('RF'));
        const tree = buildRegionTree(orgs);
        setRegionTree(tree);

        // Default to first item if available
        if (tree.length > 0) {
          setCurrentEntity(tree[0]);
        } else {
          setCurrentEntity(null);
        }
      } catch (err) {
        console.error('Failed to load orgs', err);
        setRegionTree([]);
        setCurrentEntity(null);
      } finally {
        setIsInitLoading(false);
      }
    };
    init();
  }, []);

  // Fetch data on entity change
  useEffect(() => {
    if (currentEntity && (!currentEntity.data || currentEntity.data.length === 0)) {
      setIsLoading(true);
      loadEntityData(currentEntity).then(updated => {
        setCurrentEntity(updated);
        setIsLoading(false);
      });
    }
  }, [currentEntity?.id]);

  // Close menu on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectEntity = (entity: EntityProfile) => {
    setCurrentEntity(entity);
    setIsMenuOpen(false);
  };



  // GovInsight Sub-modules
  const subNavItems = [
    { path: '/', label: '全景态势', icon: LayoutDashboard },
    { path: '/portrait', label: '精准画像', icon: Microscope },
    { path: '/operations', label: '履职效能', icon: Activity },
    { path: '/risk', label: '法治风控', icon: Scale },
    { path: '/policy', label: '制度供给', icon: Briefcase },
    { path: '/benchmark', label: '横向对标', icon: Map },
    { path: '/report', label: '智能辅策', icon: FileText },
  ];



  // Helper to render a generic row item
  const renderRow = (
    item: EntityProfile,
    isSelected: boolean, // Is this row currently highlighted as the navigation path?
    isActive: boolean,   // Is this the currently analyzed entity?
    onExpand: () => void,
    hasChildren: boolean
  ) => (
    <div
      key={item.id}
      onClick={onExpand}
      title={item.name}
      className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between group transition-colors ${isSelected
        ? 'bg-blue-50/50 text-blue-700 font-semibold'
        : 'text-slate-700 hover:bg-slate-50'
        }`}
    >
      <div className="flex items-center flex-1 min-w-0">
        {/* Analysis Active Indicator */}
        {isActive ? (
          <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-500 flex-shrink-0" />
        ) : (
          <div className="w-3.5 h-3.5 mr-1.5 flex-shrink-0"></div>
        )}
        <span className="truncate">{item.name}</span>
      </div>

      <div className="flex items-center">
        {/* "Analyze This" Button - Always visible on hover or if selected */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleSelectEntity(item);
          }}
          title={`切换数据视角至：${item.name}`}
          className={`mr-2 px-2 py-0.5 text-[10px] rounded border transition-all flex items-center ${isActive
            ? 'bg-emerald-100 text-emerald-700 border-emerald-200 cursor-default'
            : 'bg-white text-slate-500 border-slate-200 opacity-0 group-hover:opacity-100 hover:bg-blue-600 hover:text-white hover:border-blue-600'
            }`}
        >
          {isActive ? '当前视角' : '分析本级'}
        </button>

        {hasChildren && (
          <ChevronRight className={`w-3.5 h-3.5 text-slate-400 ${isSelected ? 'text-blue-500' : ''}`} />
        )}
      </div>
    </div>
  );

  if (isInitLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-500 text-sm">正在加载政务数据...</p>
        </div>
      </div>
    );
  }

  if (!currentEntity) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-center p-8 bg-white rounded-lg shadow-sm border border-slate-200">
          <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-2">暂无政务数据</h3>
          <p className="text-slate-500 text-sm max-w-xs mx-auto">
            系统中似乎没有任何行政区划数据。请联系管理员导入或同步数据。
          </p>
        </div>
      </div>
    );
  }

  return (
    <EntityContext.Provider value={{ entity: currentEntity, setEntity: setCurrentEntity, isLoading }}>
      <div className="min-h-screen bg-[#f0f2f5] font-sans flex flex-col">



        {/* 3. Module Sub-Header & Context Switcher */}
        <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shrink-0 no-print sticky top-0 z-[2000] shadow-sm">
          {/* Left: Module Tabs */}
          <nav className="flex items-center space-x-1 overflow-x-auto">
            {subNavItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center px-4 py-2 rounded-md text-sm font-medium transition-all ${isActive
                    ? 'bg-slate-800 text-white shadow-md'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`
                }
              >
                <item.icon className="w-4 h-4 mr-2" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Right: Entity Switcher (Cascader) */}
          <div className="flex items-center space-x-4 ml-4" ref={menuRef}>
            {/* Tech Spec Download Button - Moved here */}


            <div className="h-6 w-px bg-slate-200"></div>

            <div className="relative">
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="flex items-center space-x-2 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded border border-slate-200 transition-colors min-w-[260px] justify-between group"
              >
                <div className="flex flex-col items-start text-left">
                  <span className="text-[10px] text-slate-400 font-normal group-hover:text-blue-500 transition-colors">当前分析对象</span>
                  <span className="text-xs font-bold text-slate-800 flex items-center truncate max-w-[220px]">
                    <Building2 className="w-3 h-3 mr-1.5 text-indigo-500" />
                    {currentEntity.name}
                  </span>
                </div>
                <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* CASCADER DROPDOWN */}
              {isMenuOpen && (
                <div className="absolute right-0 top-full mt-2 bg-white rounded-lg shadow-2xl border border-slate-200 z-[100] flex overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 h-[420px]">

                  {/* Column 1: Province */}
                  <div className="w-48 min-w-[180px] border-r border-slate-100 overflow-y-auto bg-slate-50/50 backdrop-blur-sm">
                    <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider sticky top-0 bg-slate-50/90 backdrop-blur-md z-10 border-b border-slate-100">
                      1. 省/直辖市
                    </div>
                    {regionTree.map(prov => renderRow(
                      prov,
                      level1?.id === prov.id,
                      currentEntity?.id === prov.id,
                      () => { setLevel1(prov); setLevel2(null); setLevel3(null); },
                      true
                    ))}
                  </div>

                  {/* Column 2: City */}
                  <div className="w-48 min-w-[180px] border-r border-slate-100 overflow-y-auto bg-white/50 backdrop-blur-sm">
                    <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider sticky top-0 bg-white/90 backdrop-blur-md z-10 border-b border-slate-100">
                      2. 地级市
                    </div>
                    {level1 ? (
                      level1.children?.map(city => renderRow(
                        city,
                        level2?.id === city.id,
                        currentEntity?.id === city.id,
                        () => { setLevel2(city); setLevel3(null); },
                        !!city.children
                      ))
                    ) : (
                      <div className="p-6 text-center text-xs text-slate-400 flex flex-col items-center">
                        <MousePointerClick className="w-6 h-6 mb-2 opacity-50" />
                        请先选择左侧省份
                      </div>
                    )}
                  </div>

                  {/* Column 3: District */}
                  <div className="w-72 min-w-[240px] border-r border-slate-100 overflow-y-auto bg-slate-50/50 backdrop-blur-sm">
                    <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider sticky top-0 bg-slate-50/90 backdrop-blur-md z-10 border-b border-slate-100">
                      3. 区/县
                    </div>
                    {level2 ? (
                      level2.children ? (() => {
                        const { geo, depts } = partitionChildren(level2.children);
                        return (
                          <>
                            {/* Geographic List */}
                            {geo.length > 0 && geo.map(dist => renderRow(
                              dist,
                              level3?.id === dist.id,
                              currentEntity?.id === dist.id,
                              () => { setLevel3(dist); },
                              !!dist.children
                            ))}

                            {/* Divider if both exist */}
                            {geo.length > 0 && depts.length > 0 && (
                              <div className="px-3 py-1.5 bg-slate-100/50 text-[10px] text-slate-400 font-bold border-t border-b border-slate-100 mt-1">
                                直属部门
                              </div>
                            )}

                            {/* Departments List */}
                            {depts.map(dist => renderRow(
                              dist,
                              level3?.id === dist.id,
                              currentEntity?.id === dist.id,
                              () => { setLevel3(dist); },
                              !!dist.children
                            ))}

                            {/* Fallback if both empty (unlikely if children exists) */}
                            {geo.length === 0 && depts.length === 0 && (
                              <div className="p-4 text-center text-xs text-slate-400">无数据</div>
                            )}
                          </>
                        );
                      })() : <div className="p-4 text-center text-xs text-slate-400">无下级区划</div>
                    ) : (
                      <div className="p-6 text-center text-xs text-slate-400">请先选择城市</div>
                    )}
                  </div>

                  {/* Column 4: Department/Street */}
                  <div className="w-72 min-w-[240px] overflow-y-auto bg-white/50 backdrop-blur-sm">
                    <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider sticky top-0 bg-white/90 backdrop-blur-md z-10 border-b border-slate-100">
                      4. 部门/街道
                    </div>
                    {level3 ? (
                      level3.children ? (() => {
                        const { geo, depts } = partitionChildren(level3.children);
                        const renderItem = (dept: EntityProfile) => (
                          <div
                            key={dept.id}
                            onClick={() => handleSelectEntity(dept)}
                            title={dept.name}
                            className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between group transition-colors ${currentEntity?.id === dept.id
                              ? 'bg-indigo-50 text-indigo-700 font-bold border-l-2 border-indigo-500'
                              : 'text-slate-700 hover:bg-slate-50 hover:text-indigo-600'
                              }`}
                          >
                            <div className="flex items-center min-w-0">
                              {currentEntity?.id === dept.id && <Check className="w-3.5 h-3.5 mr-2 text-indigo-500 flex-shrink-0" />}
                              <span className="truncate">{dept.name}</span>
                            </div>
                          </div>
                        );

                        if (geo.length === 0 && depts.length === 0) {
                          return (
                            <div className="p-6 flex flex-col items-center justify-center text-slate-400 h-full">
                              <span className="text-xs mb-3 text-center">该区域暂无部门数据<br />(已到达最末级)</span>
                              {level3 && currentEntity?.id !== level3.id && (
                                <button
                                  onClick={() => handleSelectEntity(level3)}
                                  className="text-xs bg-indigo-600 text-white px-4 py-2 rounded-full hover:bg-indigo-700 shadow-md hover:shadow-lg transition-all"
                                >
                                  分析 {level3.name} 本级
                                </button>
                              )}
                            </div>
                          );
                        }

                        return (
                          <>
                            {/* Geographic List (Streets/Towns) */}
                            {geo.length > 0 && geo.map(renderItem)}

                            {/* Divider */}
                            {geo.length > 0 && depts.length > 0 && (
                              <div className="px-3 py-1.5 bg-slate-100/50 text-[10px] text-slate-400 font-bold border-t border-b border-slate-100 mt-1">
                                直属部门
                              </div>
                            )}

                            {/* Departments List */}
                            {depts.map(renderItem)}
                          </>
                        )
                      })() : (
                        <div className="p-6 flex flex-col items-center justify-center text-slate-400 h-full">
                          <span className="text-xs mb-3 text-center">该区域暂无部门数据<br />(已到达最末级)</span>
                          {level3 && currentEntity?.id !== level3.id && (
                            <button
                              onClick={() => handleSelectEntity(level3)}
                              className="text-xs bg-indigo-600 text-white px-4 py-2 rounded-full hover:bg-indigo-700 shadow-md hover:shadow-lg transition-all"
                            >
                              分析 {level3.name} 本级
                            </button>
                          )}
                        </div>
                      )
                    ) : (
                      <div className="p-6 text-center text-xs text-slate-400">请先选择区县</div>
                    )}
                  </div>

                </div>
              )}
            </div>

            <div className="flex items-center space-x-2 text-xs">
              <span className={`h-2 w-2 rounded-full ${isLoading ? 'bg-amber-500' : 'bg-emerald-500'} animate-pulse`}></span>
              <span className="text-slate-500">{isLoading ? '同步中' : '在线'}</span>
            </div>
          </div>
        </div>

        {/* 4. Main Content Area */}
        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-[1600px] mx-auto space-y-6">
            {/* Dynamic Title / Breadcrumb */}
            <div className="flex items-center text-sm text-slate-500 mb-2 no-print">
              <span>数据中心</span>
              <ChevronRight className="w-4 h-4 mx-1" />
              <span className="font-medium text-slate-800">
                {subNavItems.find(i => i.path === location.pathname)?.label || '治理分析'}
              </span>
              {location.pathname === '/report' && (
                <span className="ml-auto flex items-center text-blue-600 bg-blue-50 px-2 py-0.5 rounded text-xs">
                  <Printer className="w-3 h-3 mr-1" />
                  支持 A4 打印模式
                </span>
              )}
            </div>

            {children}
          </div>
        </main>

      </div>
    </EntityContext.Provider>
  );
};